"""Benchmarks behind research note 03 (fpv-sim-rooms-tracks-and-onboarding).

Needs Python 3.11+, `websockets` (17.x), `numpy`, `scipy`. Run:
    python -X utf8 03-bench.py edt                         # clearance field timing
    python -X utf8 03-bench.py relay 50 5 12 8803          # rooms, load processes, seconds, port

edt   : time scipy.ndimage.distance_transform_edt on random voxel scenes (10 cm voxels).
relay : one asyncio process relays N rooms x 8 pilots. Each pilot sends a 24-byte state at 30 Hz;
        the server keeps the latest state per pilot and broadcasts ONE batched snapshot per room
        every 33 ms (latest-state-wins). Reports server CPU (share of one core), tick lateness and
        the age of each pilot's own state when it comes back inside the snapshot.
Localhost, no TLS, no real network: the numbers are a lower bound on cost, not a promise.
"""
import asyncio, json, os, struct, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
TICK, PILOTS, HZ, MSG = 1 / 30, 8, 30, 24


def edt():
    import numpy as np
    from scipy import ndimage as ndi
    rng = np.random.default_rng(1)
    for shape in [(128, 64, 128), (256, 128, 256), (384, 192, 384)]:
        g = np.zeros(shape, dtype=bool)
        g[0] = g[-1] = True
        g[:, 0] = True
        g[:, -1] = True
        g[:, :, 0] = True
        g[:, :, -1] = True
        for _ in range(300):
            s = rng.integers(3, 20, 3)
            p = [rng.integers(0, max(1, shape[i] - s[i])) for i in range(3)]
            g[p[0]:p[0] + s[0], p[1]:p[1] + s[1], p[2]:p[2] + s[2]] = True
        t = time.perf_counter()
        d = ndi.distance_transform_edt(~g, sampling=0.1)
        print(shape, 'voxels %.1f M' % (g.size / 1e6), 'EDT %.2f s' % (time.perf_counter() - t), 'max clearance %.2f m' % d.max())


async def server_main(port, duration, out):
    from websockets.asyncio.server import serve, broadcast
    rooms = {}

    async def handler(ws):
        room = rooms.setdefault(ws.request.path.rsplit('/', 1)[-1], {'clients': set(), 'state': {}})
        room['clients'].add(ws)
        try:
            async for msg in ws:
                room['state'][msg[0]] = msg  # byte 0 = pilot index; latest state wins
        finally:
            room['clients'].discard(ws)

    async def ticker(stop_at):
        lates, cpu0, t0, nxt, sent = [], time.process_time(), time.perf_counter(), time.perf_counter(), 0
        while time.perf_counter() < stop_at:
            nxt += TICK
            for r in rooms.values():
                if r['clients']:
                    broadcast(r['clients'], b''.join(r['state'].values()))
                    sent += 1
            d = nxt - time.perf_counter()
            if d > 0:
                await asyncio.sleep(d)
            lates.append(max(0.0, time.perf_counter() - nxt))
            await asyncio.sleep(0)
        wall, cpu = time.perf_counter() - t0, time.process_time() - cpu0
        lates.sort()
        json.dump({'cpu_pct_one_core': round(100 * cpu / wall, 1),
                   'tick_late_p99_ms': round(1000 * lates[int(len(lates) * .99)], 2),
                   'snapshots_sent': sent}, open(out, 'w'))

    async with serve(handler, '127.0.0.1', port, compression=None, max_queue=4, ping_interval=None):
        await ticker(time.perf_counter() + duration)


async def load_main(port, room0, nrooms, duration, out):
    from websockets.asyncio.client import connect
    lat, tx = [], [0]

    async def pilot(rid, idx, stop_at):
        async with connect(f'ws://127.0.0.1:{port}/room/{rid}', compression=None, ping_interval=None, max_queue=64) as ws:
            async def reader():
                async for snap in ws:
                    for off in range(0, len(snap), MSG):
                        if snap[off] == idx:
                            lat.append(time.time() - struct.unpack_from('<d', snap, off + 8)[0])
                            break
            task = asyncio.create_task(reader())
            nxt = time.perf_counter()
            while time.perf_counter() < stop_at:
                nxt += 1 / HZ
                await ws.send(struct.pack('<Bxxxxxxxd', idx, time.time()) + b'\0' * (MSG - 16))
                tx[0] += 1
                d = nxt - time.perf_counter()
                if d > 0:
                    await asyncio.sleep(d)
            task.cancel()

    stop_at = time.perf_counter() + duration
    await asyncio.gather(*(pilot(room0 + r, i, stop_at) for r in range(nrooms) for i in range(PILOTS)), return_exceptions=True)
    lat.sort()
    json.dump({'tx': tx[0], 'lat_p50_ms': round(1000 * lat[len(lat) // 2], 2) if lat else None,
               'lat_p99_ms': round(1000 * lat[int(len(lat) * .99)], 2) if lat else None}, open(out, 'w'))


def relay(rooms, procs, dur, port):
    srv_out = os.path.join(HERE, f'.relay_srv_{rooms}.json')
    srv = subprocess.Popen([sys.executable, '-X', 'utf8', __file__, '_server', str(port), str(dur + 6), srv_out])
    time.sleep(1.5)
    per = rooms // procs
    cl = [subprocess.Popen([sys.executable, '-X', 'utf8', __file__, '_load', str(port), str(i * per), str(per), str(dur),
                            os.path.join(HERE, f'.relay_cl_{rooms}_{i}.json')]) for i in range(procs)]
    for p in cl:
        p.wait()
    srv.wait()
    s = json.load(open(srv_out))
    c = [json.load(open(os.path.join(HERE, f'.relay_cl_{rooms}_{i}.json'))) for i in range(procs)]
    print(json.dumps({'rooms': rooms, 'pilots': rooms * PILOTS, **s,
                      'client_age_p50_ms': max(x['lat_p50_ms'] or 0 for x in c), 'client_age_p99_ms': max(x['lat_p99_ms'] or 0 for x in c),
                      'sent_vs_expected': round(sum(x['tx'] for x in c) / (rooms * PILOTS * HZ * dur), 3)}))
    for f in [srv_out] + [os.path.join(HERE, f'.relay_cl_{rooms}_{i}.json') for i in range(procs)]:
        os.remove(f)


if __name__ == '__main__':
    cmd = sys.argv[1]
    if cmd == 'edt':
        edt()
    elif cmd == 'relay':
        relay(*map(int, sys.argv[2:6]))
    elif cmd == '_server':
        asyncio.run(server_main(int(sys.argv[2]), float(sys.argv[3]), sys.argv[4]))
    elif cmd == '_load':
        asyncio.run(load_main(int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4]), float(sys.argv[5]), sys.argv[6]))
    else:
        raise SystemExit(__doc__)

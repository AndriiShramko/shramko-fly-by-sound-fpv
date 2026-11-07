# Consent template: testing Fly by Sound with children and students

> **NOT LEGAL ADVICE. / NIE JEST PORADĄ PRAWNĄ.**
> This is a template written by the project's engineers from the practical outline in [research 02, section 9](../research/02-sensory-substitution-and-training.md). It is not checked by a lawyer. Before it is used, the school's data protection officer (in Poland: *Inspektor Ochrony Danych*, IOD) and a lawyer who knows Polish and EU law must read it, change it to the real situation and approve it. Nothing here promises compliance with the GDPR or with Polish law.
> To jest szablon przygotowany przez inżynierów projektu na podstawie praktycznego zarysu w [badaniu 02, sekcja 9](../research/02-sensory-substitution-and-training.md). Nie sprawdził go prawnik. Zanim zostanie użyty, inspektor ochrony danych szkoły (IOD) oraz prawnik znający prawo polskie i unijne muszą go przeczytać, dostosować do rzeczywistej sytuacji i zatwierdzić. Nic tutaj nie gwarantuje zgodności z RODO ani z prawem polskim.

## How to use it

1. Fill every field in `[square brackets]`. Delete what does not apply. Keep the rest as it is, so that each consent stays separate and optional.
2. The school sends the forms to parents or guardians, so that names stay with the school. The project never needs a child's name: the test uses a random participant code and an optional nickname.
3. Keep the signed forms with the school (or with the controller named in them), never together with the session packages.
4. For anyone under 18 the helper confirms in the app that a parent's or guardian's signed consent exists (the consent screen asks). Without it, nothing is recorded or sent.
5. The consents below are separate on purpose, and the app asks for them separately too: **recording** the flight, recording the child's **voice**, **sending** the package, and the browser's **speech recognition**. Each can be refused without any effect on the others, and on taking part.

| Item in the form | What the app stores in `manifest.json` (field `consent`) |
|---|---|
| Part 1, taking part with a play log | `recording` |
| Part 2, voice recording | `voice` |
| Part 3, sending the package | `send` |
| Part 4, speech recognition | `speechRecognition` |
| the child is under 18 | `minor` |
| a parent's signed consent was confirmed by the helper | `guardianConfirmed` |

---

# Part A. English

## A1. Information for parents and guardians

**Project:** Fly by Sound (ShramkoSonicFPV), an open-source sound engine and lessons that let people fly a simulated FPV drone by ear. It is a game that people choose to play. It is **not** a therapy, a medical device or a treatment, and nobody can promise it will help with anything beyond the game.

**What the test is:** your child sits at a computer with wired headphones and plays the first lessons of the game with a keyboard or a game controller. A helper (an adult from [the school or organisation]) sits beside the child. The child hears the instructions by voice and flies a small simulated drone through a room and through rings, guided only by sound. No real drone is flown. A session lasts at most [30] minutes and has breaks. Taking part is **voluntary**, has **no effect on marks** or on anything else at school, and your child can stop at any moment without giving a reason.

**Why we ask:** to find out whether, how fast and with which sounds people learn to fly by ear, so that the game can be made better for blind, low-vision and sighted players.

**Who is responsible for the data (the controller):** [full name and address of the controller, for example the school or the project's author], contact: [e-mail]. School data protection officer: [name and e-mail of the IOD, or "none appointed"]. Project contact: Andrii Shramko, [e-mail].

**What is collected, and what is not:**

- **Always, if you agree to Part 1:** a *random participant code* (no name), the date, the technical settings of the session (browser, device type, language, sound theme), a *play log* (where the simulated drone was, the keys or sticks used, which lessons were passed, touches, times) and the answers to a short spoken survey given by number keys.
- **Only if you agree to Part 2:** a *recording of your child's voice* while they fly, for example comments such as "I hear the wall on my left". A voice recording is personal data and can identify a person, so it is never made without this separate consent.
- **Never:** your child's name, address, photo or video, school class, or any diagnosis. If the helper learns about your child's vision, the helper does not write it down with the participant code. If you choose to tell us something about your child's sight, that is information about health, which the law protects specially; we will use it only if you say so in writing and only for this research.
- The session is kept on the child's computer first. It is **sent** to the project only if you agree to Part 3 and the helper confirms it at the end of the session.

**Why we may use it (legal basis):** your consent (GDPR Articles 6(1)(a) and, for health information or voice data treated as special category data, Article 9(2)(a)) [the controller completes or changes this line with the IOD]. For a child under 16 the consent of the parent or guardian is needed (GDPR Article 8; Poland has not lowered the age), and we also ask the child, in words suited to their age, whether they want to take part.

**Who receives it:** the project's author Andrii Shramko and [the researchers named here: ...]. Sent packages travel over the internet to the project's server, which keeps them first and then forwards them to the author by e-mail and by the Telegram messenger. These services are used as processors or recipients: [the controller lists the hosting provider, e-mail provider and messenger, and says whether data leaves the EU/EEA and on what basis]. Nothing is published with a name or a voice. Results may be published only as anonymous summaries.

**How long:** session packages are kept while the project runs and for at most 5 years, and are deleted earlier if you or your child ask. [The controller confirms the period with the IOD.]

**Your rights:** you can ask for access to the data, correction, deletion, restriction or transfer, and you can **withdraw any consent at any time, as easily as you gave it**, without any effect on the lawfulness of what was done before. To use these rights, contact [contact]. Quote the participant code, which you will get on a card; without it we cannot find the data, because we do not hold a name. You can complain to the President of the Personal Data Protection Office (UODO, https://uodo.gov.pl).

**Safety:** the sound is limited, the headphones are wired, and the loudness at this site has been checked against the references of 75 dBA for children and 80 dBA for adults (WHO/ITU) [the school confirms the check was done, date: ...]. The helper stops the session at once if your child says the sound is too loud, if there is discomfort or tiredness, or at your request.

## A2. Consent of the parent or guardian

Participant code (written by the helper, **not** the child's name): `[code]`

Child's age group: [ ] under 13 [ ] 13 to 15 [ ] 16 to 17

I have read the information above and had the chance to ask questions. I know that taking part is voluntary and that my child can stop at any time.

| | I agree | I do not agree |
|---|---|---|
| **Part 1.** My child may take part in the test, and a play log with a random code, the technical settings of the session and the survey answers may be kept and used for the research described. | [ ] | [ ] |
| **Part 2.** My child's **voice** may be recorded during the flights (optional; the test goes on without it). | [ ] | [ ] |
| **Part 3.** The session package may be **sent** to the project over the internet, and kept as described above (optional; without it nothing leaves the computer). | [ ] | [ ] |
| **Part 4.** My child may use the browser's **speech recognition** to give voice commands. I know that this sends the sound of the voice to the company that makes the browser, which is outside the project's control (optional; keys work as well). | [ ] | [ ] |

Parent or guardian: [name in print] Relation to the child: [ ] Date: [ ] Signature: [ ]

*If both parents have parental authority, the signature of one is enough for the school's purposes, but either can withdraw the consent.* [the controller confirms with the IOD]

## A3. Assent of the child (the helper reads it aloud, in simple words)

"We are going to play a flying game with sound. You wear headphones. You will hear a voice that tells you what to do, and sounds that tell you where things are. You do not need to see. It is not a test of you: it is a test of the game. If you want to stop, say *stop* and we stop, and nobody will mind. If the sound is too loud or you feel tired, tell me. Is it all right to play? Is it all right if we keep a note of how the game went, using a number and not your name? Would you also like us to record your voice, or not?"

Child's answers (the helper writes): plays [ ] yes [ ] no. Notes with a number only [ ] yes [ ] no. Voice recorded [ ] yes [ ] no. A child who says no, or looks unhappy, is not asked again that day.

## A4. School cooperation and the head teacher's permission

| | |
|---|---|
| Activity | Testing of the game *Fly by Sound* with pupils, as described in A1 |
| School | [name and address] |
| Dates and rooms | [ ] |
| Helpers (teachers or staff, adults who have had the instructions) | [first names or roles] |
| Controller of the data | [ ] The school [ ] The project's author [ ] Joint controllers (the arrangement is attached; its essence is shown to the families, GDPR Article 26) |
| Processors | [ ] A processor contract exists where one party only hosts or stores data for another (GDPR Article 28): [ ] |
| Loudness check | [ ] Done on [date] with [instrument], by [role]; results kept in the school's loudness sheet (`school-loudness-sheet.md`) |
| Consents | [ ] The school sends the forms and keeps the signed ones; the project receives only participant codes and never names |
| Voluntary | [ ] The letter to families says clearly that taking part is voluntary and has no effect on marks |
| Contact for withdrawal and complaints | [ ] |

Head teacher: [name in print] Date: [ ] Signature and stamp: [ ]

---

# Część B. Po polsku

## B1. Informacja dla rodziców i opiekunów prawnych

**Projekt:** Fly by Sound (ShramkoSonicFPV), otwarty silnik dźwiękowy i lekcje, dzięki którym można pilotować symulowanego drona FPV „na słuch”. To gra, w którą ludzie grają z własnego wyboru. To **nie** jest terapia, wyrób medyczny ani leczenie i nikt nie może obiecać, że pomoże w czymkolwiek poza samą grą.

**Na czym polega test:** Państwa dziecko siedzi przy komputerze w przewodowych słuchawkach i gra w pierwsze lekcje, używając klawiatury lub kontrolera do gier. Obok siedzi pomocnik (dorosła osoba z [szkoły lub organizacji]). Dziecko słyszy polecenia głosem i steruje małym symulowanym dronem w pomieszczeniu i przez obręcze, kierując się wyłącznie dźwiękiem. Żaden prawdziwy dron nie lata. Jedna sesja trwa najwyżej [30] minut i zawiera przerwy. Udział jest **dobrowolny**, **nie wpływa na oceny** ani na nic innego w szkole, a dziecko może przerwać w każdej chwili bez podawania powodu.

**Po co pytamy:** chcemy sprawdzić, czy, jak szybko i przy pomocy jakich dźwięków ludzie uczą się latać na słuch, aby grę można było ulepszyć dla osób niewidomych, słabowidzących i widzących.

**Kto odpowiada za dane (administrator):** [pełna nazwa i adres administratora, na przykład szkoły lub autora projektu], kontakt: [e-mail]. Inspektor ochrony danych szkoły: [imię, nazwisko i e-mail IOD, albo „nie wyznaczono”]. Kontakt do projektu: Andrii Shramko, [e-mail].

**Co zbieramy, a czego nie:**

- **Zawsze, jeśli wyrażą Państwo zgodę w Części 1:** *losowy kod uczestnika* (bez imienia i nazwiska), datę, techniczne ustawienia sesji (przeglądarka, rodzaj urządzenia, język, motyw dźwiękowy), *dziennik gry* (gdzie był symulowany dron, jakich klawiszy lub drążków użyto, które lekcje zaliczono, zderzenia, czasy) oraz odpowiedzi na krótką ankietę czytaną głosem, udzielane klawiszami z cyframi.
- **Tylko jeśli wyrażą Państwo zgodę w Części 2:** *nagranie głosu dziecka* podczas lotu, na przykład komentarzy typu „słyszę ścianę po lewej”. Nagranie głosu jest daną osobową i może pozwolić na rozpoznanie osoby, dlatego nigdy nie powstaje bez tej odrębnej zgody.
- **Nigdy:** imienia i nazwiska dziecka, adresu, zdjęcia ani filmu, klasy ani żadnej diagnozy. Jeśli pomocnik dowie się czegoś o wzroku dziecka, nie zapisuje tego razem z kodem uczestnika. Jeśli sami Państwo zdecydują się powiedzieć nam coś o wzroku dziecka, jest to informacja o zdrowiu, którą prawo chroni w szczególny sposób; wykorzystamy ją tylko wtedy, gdy napiszą to Państwo wyraźnie, i tylko do tych badań.
- Sesja zapisuje się najpierw na komputerze dziecka. Do projektu jest **wysyłana** tylko wtedy, gdy wyrażą Państwo zgodę w Części 3, a pomocnik potwierdzi wysłanie na końcu sesji.

**Podstawa prawna:** Państwa zgoda (art. 6 ust. 1 lit. a RODO oraz, dla informacji o zdrowiu lub danych głosowych traktowanych jako szczególna kategoria, art. 9 ust. 2 lit. a) [administrator uzupełnia lub zmienia ten wiersz razem z IOD]. W przypadku dziecka poniżej 16 lat potrzebna jest zgoda rodzica lub opiekuna prawnego (art. 8 RODO; Polska nie obniżyła tego wieku), a dodatkowo pytamy dziecko, w słowach dostosowanych do wieku, czy chce wziąć udział.

**Kto otrzymuje dane:** autor projektu Andrii Shramko oraz [wymienieni tutaj badacze: ...]. Wysłane pakiety trafiają przez internet na serwer projektu, który najpierw je przechowuje, a potem przekazuje autorowi pocztą elektroniczną i komunikatorem Telegram. Te usługi działają jako podmioty przetwarzające lub odbiorcy: [administrator wymienia dostawcę hostingu, poczty i komunikatora oraz podaje, czy dane opuszczają EOG i na jakiej podstawie]. Nic nie jest publikowane z imieniem i nazwiskiem ani z głosem. Wyniki mogą być publikowane wyłącznie jako anonimowe zestawienia.

**Jak długo:** pakiety sesji są przechowywane tak długo, jak trwa projekt, nie dłużej niż 5 lat, a wcześniej są usuwane na Państwa lub dziecka prośbę. [Administrator potwierdza okres z IOD.]

**Państwa prawa:** mogą Państwo żądać dostępu do danych, ich sprostowania, usunięcia, ograniczenia przetwarzania lub przeniesienia, a **każdą zgodę mogą Państwo cofnąć w dowolnej chwili, równie łatwo, jak ją wyrażono**, bez wpływu na zgodność z prawem tego, co zrobiono wcześniej. Aby skorzystać z tych praw, prosimy o kontakt: [kontakt]. Proszę podać kod uczestnika, który otrzymają Państwo na karcie; bez niego nie znajdziemy danych, bo nie mamy imienia i nazwiska. Mogą Państwo złożyć skargę do Prezesa Urzędu Ochrony Danych Osobowych (UODO, https://uodo.gov.pl).

**Bezpieczeństwo:** dźwięk jest ograniczony, słuchawki są przewodowe, a głośność w tym miejscu sprawdzono względem wartości odniesienia 75 dBA dla dzieci i 80 dBA dla dorosłych (WHO/ITU) [szkoła potwierdza, że sprawdzenie wykonano, data: ...]. Pomocnik natychmiast przerywa sesję, jeśli dziecko powie, że dźwięk jest za głośny, przy dyskomforcie lub zmęczeniu albo na Państwa prośbę.

## B2. Zgoda rodzica lub opiekuna prawnego

Kod uczestnika (wpisuje pomocnik, **nie** imię i nazwisko dziecka): `[kod]`

Grupa wiekowa dziecka: [ ] poniżej 13 lat [ ] 13 do 15 lat [ ] 16 do 17 lat

Przeczytałem(-am) powyższą informację i miałem(-am) możliwość zadania pytań. Wiem, że udział jest dobrowolny i że dziecko może przerwać w każdej chwili.

| | Wyrażam zgodę | Nie wyrażam zgody |
|---|---|---|
| **Część 1.** Moje dziecko może wziąć udział w teście, a dziennik gry z losowym kodem, techniczne ustawienia sesji i odpowiedzi na ankietę mogą być przechowywane i wykorzystane do opisanych badań. | [ ] | [ ] |
| **Część 2.** **Głos** mojego dziecka może być nagrywany podczas lotów (dobrowolnie; test przebiega także bez tego). | [ ] | [ ] |
| **Część 3.** Pakiet sesji może zostać **wysłany** do projektu przez internet i przechowywany w opisany wyżej sposób (dobrowolnie; bez tego nic nie opuszcza komputera). | [ ] | [ ] |
| **Część 4.** Moje dziecko może używać **rozpoznawania mowy** w przeglądarce do wydawania poleceń głosem. Wiem, że wysyła to dźwięk głosu do firmy tworzącej przeglądarkę, co jest poza kontrolą projektu (dobrowolnie; klawisze działają tak samo). | [ ] | [ ] |

Rodzic lub opiekun prawny: [imię i nazwisko drukowanymi literami] Stosunek do dziecka: [ ] Data: [ ] Podpis: [ ]

*Jeśli władzę rodzicielską mają oboje rodzice, na potrzeby szkoły wystarczy podpis jednego z nich, ale każdy może cofnąć zgodę.* [administrator potwierdza z IOD]

## B3. Zgoda dziecka (pomocnik czyta na głos, prostymi słowami)

„Zagramy w grę o lataniu, w której liczy się dźwięk. Masz słuchawki. Usłyszysz głos, który mówi, co robić, i dźwięki, które mówią, gdzie co jest. Nie musisz widzieć. To nie jest sprawdzian ciebie, tylko sprawdzian gry. Jeśli zechcesz przerwać, powiedz *stop* i przerywamy, i nikt nie będzie miał pretensji. Jeśli dźwięk jest za głośny albo czujesz zmęczenie, powiedz mi. Czy chcesz zagrać? Czy może zostać zapisana notatka o tym, jak poszła gra, z numerem zamiast twojego imienia? A czy chcesz, żebyśmy nagrali też twój głos, czy nie?”

Odpowiedzi dziecka (zapisuje pomocnik): gra [ ] tak [ ] nie. Notatki z numerem [ ] tak [ ] nie. Nagranie głosu [ ] tak [ ] nie. Dziecka, które mówi „nie” albo wygląda na niezadowolone, nie pytamy ponownie tego dnia.

## B4. Współpraca ze szkołą i zgoda dyrektora

| | |
|---|---|
| Działanie | Testowanie gry *Fly by Sound* z uczniami, jak opisano w B1 |
| Szkoła | [nazwa i adres] |
| Terminy i sale | [ ] |
| Pomocnicy (nauczyciele lub pracownicy, dorośli po zapoznaniu z instrukcją) | [imiona lub role] |
| Administrator danych | [ ] Szkoła [ ] Autor projektu [ ] Współadministratorzy (ustalenia w załączeniu; ich istota jest przedstawiona rodzinom, art. 26 RODO) |
| Podmioty przetwarzające | [ ] Umowa powierzenia istnieje tam, gdzie jedna strona tylko hostuje lub przechowuje dane dla drugiej (art. 28 RODO): [ ] |
| Sprawdzenie głośności | [ ] Wykonane dnia [data] przyrządem [przyrząd], przez [rola]; wyniki w arkuszu głośności szkoły (`school-loudness-sheet.md`) |
| Zgody | [ ] Szkoła rozsyła formularze i przechowuje podpisane; projekt otrzymuje tylko kody uczestników i nigdy imion i nazwisk |
| Dobrowolność | [ ] List do rodzin mówi wyraźnie, że udział jest dobrowolny i nie wpływa na oceny |
| Kontakt w sprawie cofnięcia zgody i skarg | [ ] |

Dyrektor: [imię i nazwisko drukowanymi literami] Data: [ ] Podpis i pieczęć: [ ]

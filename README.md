# YouTopic

Polskojęzyczny prototyp serwisu społecznościowego z tablicą postów, profilami, Ekipą, powiadomieniami i zapisanymi wpisami.

## Uruchomienie

Wymagany jest Node.js 20.19+ lub 22.12+.

```bash
npm install
cp .env.example .env
npm run dev
```

Polecenie `npm run dev` uruchamia Vite oraz API uwierzytelniania. W PowerShell plik środowiskowy skopiujesz poleceniem `Copy-Item .env.example .env`.

## Wysyłka E-mail i SMS

W pliku `.env` ustaw:

- `AUTH_SESSION_SECRET` na długi, losowy sekret.
- `SMTP_URL` i `SMTP_FROM` dla serwera pocztowego, który wyśle link potwierdzający.
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` i `TWILIO_FROM_NUMBER` dla wysyłki SMS przez Twilio. Numer telefonu podawaj w formacie międzynarodowym, np. `+48123456789`.
- `APP_URL` na publiczny adres aplikacji; link potwierdzenia e-mail używa tej wartości.

Bez poprawnych danych SMTP rejestracja nie wyśle linku aktywacyjnego ani kodów na e-mail. Logowanie SMS jest obecnie tymczasowo wyłączone; SMS pozostaje używany do potwierdzania zmiany numeru i może być wybrany przy odzyskiwaniu hasła zweryfikowanego konta. Nie umieszczaj sekretów w kodzie ani repozytorium. Kompilację produkcyjną sprawdzisz poleceniem `npm run build`.

## Wdrożenie testowe

Frontend jest hostowany na Vercel pod adresem `https://you-topic.vercel.app`. API Express wymaga osobnego hostingu; w produkcji wymaga też PostgreSQL ustawionego przez `DATABASE_URL`. W środowisku developerskim, jeśli `DATABASE_URL` nie jest ustawiony, konta nadal są przechowywane w `data/auth-store.json`. Produkcyjne API nie uruchomi się bez bazy danych i `AUTH_SESSION_SECRET`.

Docelowy wariant testowy używa bezpłatnego serwisu webowego Render i PostgreSQL Neon. Darmowy serwis Render może usypiać się po okresie bezczynności, a darmowy plan bazy ma limity, które mogą się zmieniać — nie traktuj tego jako konfiguracji produkcyjnej. Plik `vercel.json` przekierowuje żądania `/api/*` do API na Renderze, dzięki czemu sesja pozostaje na domenie aplikacji. Ustaw `APP_URL` i `APP_ORIGINS` na `https://you-topic.vercel.app`, `NODE_ENV=production`, `DATABASE_URL` z panelu Neon, `AUTH_SESSION_SECRET` wygenerowany osobno oraz `SMTP_URL` i `SMTP_FROM` dla poczty. Sekrety wpisuj wyłącznie w ustawieniach hostingu, nigdy w repozytorium ani w czacie. Nie kopiuj lokalnego `.env` ani `data/auth-store.json` do wdrożenia.

## Panel administratora

Panel jest osobną aplikacją w katalogu `admin/` i korzysta z istniejącego API. Lokalnie uruchom `npm run dev` oraz w drugim terminalu `npm run dev:admin`; panel będzie dostępny pod `http://127.0.0.1:5174`. Logowanie administratorów ma osobne konto, hasło i sesję. Ustaw `SUPER_ADMIN_EMAIL` w lokalnym `.env` oraz jako zmienną środowiskową API na Renderze na adres już zarejestrowanego i potwierdzonego konta YouTopic. Przy pierwszym logowaniu serwer utworzy dla tego adresu Super Administratora, używając dotychczasowego hasła konta YouTopic. Od tego momentu hasło panelu można zmienić niezależnie w zakładce „Administratorzy”; własny e-mail logowania i nazwę również można tam edytować, ale rangi Super Administratora nie można zmienić ani usunąć. Nie wpisuj sekretów do kodu ani repozytorium.

Super Administrator może tworzyć niezależne konta administratorów, ustawiać im hasła, nadawać jedną z rang (również własną) i przydzielać uprawnienia. Katalog uprawnień jest współdzielony przez API i interfejs w `shared/adminPermissions.js`; nowe funkcje panelu należy dopisać do tego katalogu i zabezpieczyć odpowiednim middleware. Tylko Super Administrator może zmieniać rangi/uprawnienia i usuwać konta; zmiana hasła administratora unieważnia jego poprzednie sesje. Serwer weryfikuje uprawnienia przy każdym żądaniu API, a panel pokazuje wyłącznie dozwolone funkcje. Panel pokazuje statystyki kont, listę użytkowników ze zdjęciem profilowym, nickiem i statusem potwierdzenia e-mail, pozwala weryfikować profile, przeglądać i oznaczać zgłoszenia jako sprawdzone oraz usuwać konta z anonimizowanym wpisem historii. Blokada konta może trwać 7 dni, 30 dni lub 3 miesiące; opcjonalna blokada IP wygasa razem z blokadą konta, a API zapisuje wyłącznie HMAC-skrót adresu IP. Endpointy panelu administracyjnego pozostają dostępne z zablokowanego IP, aby administrator mógł zdjąć blokadę. Przycisk kontaktu z użytkownikiem jest widoczny po przyznaniu uprawnienia, ale pozostaje nieaktywny do czasu wdrożenia komunikatora 1:1 z trwałym zapisem wiadomości. Komunikaty można publikować natychmiast albo zaplanować na lokalną datę i godzinę startu oraz opcjonalny koniec; API weryfikuje harmonogram i udostępnia komunikat wyłącznie w jego aktywnym przedziale. Zalogowana strona YouTopic odświeża komunikaty co 15 sekund i po powrocie karty na pierwszy plan. Blokada jest egzekwowana przez API i unieważnia aktywne sesje. Komunikaty są przechowywane w bazie kont i wyświetlane zalogowanym użytkownikom. Aby zbudować sam panel pod osobny projekt Vercel, ustaw polecenie budowania `npm run build:admin` i katalog wyjściowy `dist-admin`; katalog główny repozytorium pozostaje taki sam. Po podpięciu własnej subdomeny administratora dodaj jej adres do `APP_ORIGINS` na Renderze. Ponieważ panel używa sesji API, zalecana jest subdomena w obrębie `youtopic.pl` (np. `admin.youtopic.pl`) zamiast odrębnej domeny `vercel.app`.

Zestawy uprawnień są zapamiętywane jako szablony rang: wybór rangi podczas tworzenia konta wypełnia uprawnienia, a zapisanie uprawnień administratora aktualizuje domyślny zestaw dla jego rangi. Administratorzy zarządzający modułem pomocy, ustawieniami lub rejestrem treści automatycznie otrzymują też dostęp do odczytu tego modułu.

Panel ma dodatkowe sekcje: statystyki rejestracji z ostatnich 30 dni, stan API/bazy i konfiguracji dostawców, dziennik udanych zmian administratorów (bez zapisywania treści żądań), centrum pomocy z odpowiedziami dla użytkowników, ustawienie dostępności nowych rejestracji oraz rejestr usuniętych treści. Każda sekcja ma osobne uprawnienie. Rejestracja jest włączona domyślnie; wyłączenie blokuje tworzenie nowych kont, nie logowanie istniejących. Centrum pomocy zapisuje sprawy w API i umożliwia administratorowi odpowiedź oraz zmianę statusu.

Ograniczenia danych: statystyki dotyczą wyłącznie informacji faktycznie zapisanych w API (konta, zgłoszenia, sprawy pomocy i komunikaty), bez odsłon i aktywności feedu. Publiczne posty, zdjęcia/filmy, komentarze tekstowe i głosowe, polubienia, zapisywanie oraz podbijanie są zapisywane przez API w PostgreSQL i widoczne po zalogowaniu na innym urządzeniu; API odświeża feed co 15 sekund. Zdjęcia są zmniejszane do maksymalnie 1600 px, kompresowane do JPEG i wysyłane do serwera przy publikacji; zachowują jakość przy mniejszym rozmiarze. Pliki są obecnie przechowywane jako bajty w tej samej bazie danych (zdjęcie do 8 MB, film do 20 MB, nagranie do 5 MB), co jest rozwiązaniem prototypowym — przy większym ruchu należy przenieść media do trwałego magazynu obiektowego. Wyszukiwarka i proponowane profile korzystają z kont zarejestrowanych na platformie, a zaproszenia do Ekipy i zaakceptowane relacje są zapisywane przez API i synchronizują się między urządzeniami. Bandy, relacje, czaty oraz część ustawień pozostają lokalne. Nawigacja przeglądarki „wstecz” przywraca poprzedni widok YouTopic. Sekcja „Treści” panelu nie jest jeszcze centralnym menedżerem postów.

Zakładka „Użytkownicy” pobiera z centralnego API wszystkie konta zarejestrowane na platformie (również zanonimizowane wpisy kont usuniętych), niezależnie od przeglądarki. Profile demonstracyjne przechowywane wyłącznie w `localStorage` nie są kontami platformy.

Super Administrator ma dostęp do wszystkich danych. Pozostałym administratorom można osobno przyznać uprawnienie „Wyświetlanie danych osobowych” (miejscowość, data urodzenia, płeć i numery telefonu); API ukrywa te pola bez tego uprawnienia. Kliknięcie nagłówka kolumny w tabeli użytkowników otwiera filtr dla tej kolumny; można stosować kilka filtrów równocześnie.

Zakładka „Zgłoszenia” wymaga osobnych uprawnień „Przeglądanie zgłoszeń użytkowników” i „Podejmowanie decyzji w zgłoszeniach i powiadamianie użytkowników”. Obsługuje zgłoszenia profili, postów, zdjęć, wideo, komentarzy oraz wiadomości w publicznym czacie i Pokojach. Panel pozwala odrzucić zgłoszenie, przekazać ostrzeżenie, usunąć zgłoszoną treść albo zablokować konto (ta ostatnia akcja wymaga też uprawnienia do blokowania kont). Przy decyzji administrator wybiera, czy powiadomić zgłaszającego i osobę, której dotyczy zgłoszenie; powiadomienia są dostępne na koncie YouTopic w „Powiadomieniach”. Publiczne posty i komentarze są już zapisywane w API, ale panel nie udostępnia jeszcze centralnego przeglądania ani usuwania postów. Wiadomości w czacie pozostają lokalne.

Publiczne posty i komentarze są synchronizowane przez API. Gdy API działa bez `DATABASE_URL`, dane deweloperskie trafiają do lokalnego pliku `data/auth-store.json` i nie są dostępne z innego komputera; między urządzeniami synchronizują się dopiero przez wspólną bazę PostgreSQL. Wpisy zapisane wcześniej wyłącznie w pamięci przeglądarki nie są automatycznie przenoszone na serwer; stare załączniki `blob:` są tymczasowe i trzeba dodać je ponownie. Centralna moderacja i usuwanie postów z panelu administratora nie są jeszcze dostępne.

## Funkcje prototypu

- Ekran rejestracji z imieniem, nazwiskiem, płcią, datą urodzenia (minimum 15 lat), adresem e-mail, telefonem i hasłem. E-mail wymaga potwierdzenia. Logowanie jest obecnie dostępne wyłącznie przez e-mail i hasło; logowanie numerem telefonu oraz kod SMS przy nowym urządzeniu są tymczasowo wyłączone.
- Publiczny Chat dostępny dla wszystkich kont, prywatne Pokoje użytkowników oraz serwerowe zaproszenia do Ekipy z akceptacją po drugiej stronie.
- Wiele prywatnych band: członkowie mają dostęp, mogą tworzyć własne bandy, zapraszać ekipowiczów, publikować posty i relacje, a admin ma niebieski badge.
- Prywatny feed bandy: wpisy tekstowe, zdjęcia, filmy i linki zewnętrzne; członkowie mogą lajkować i komentować, a posty można przypinać w Bandzie. Publiczne posty można udostępniać do bandy, nigdy odwrotnie na Tablicę.
- Licznik nieprzeczytanych postów, podgląd osób, które widziały wpis, i relacje wygasające po 24 godzinach.
- Dodawanie publicznych postów tekstowych, zdjęć i filmów zapisywanych na serwerze; publiczne posty oraz komentarze można przeglądać po zalogowaniu na innym urządzeniu.
- Wyszukiwanie zweryfikowanych kont platformy, proponowanie użytkowników do Ekipy oraz serwerowe zaproszenia i relacje.
- Polubienia, komentarze tekstowe i głosowe (do 60 sekund), polubienia komentarzy, wątki odpowiedzi, liczniki oraz usuwanie własnych komentarzy.
- Podbijanie i zapisywanie postów.
- Obserwowanie tematów, odkrywanie tematów z licznikami postów i Topików oraz widok Tablicy „Obserwowane”; wybór obserwowanych tematów jest zapisywany lokalnie dla konta.
- Posty publiczne można przypisywać do tematu, a jego stronę otworzyć z poziomu wpisu lub katalogu tematów.
- Tablica „Dla Ciebie” pokazuje posty użytkownika oraz osób z jego Ekipy; tematy można obserwować niezależnie od Ekipy.
- Profile z liczbą Ekipowiczów, powiadomienia, wyszukiwarka i odkrywanie tematów.
- Edycja profilu: imię, nazwisko, opcjonalne drugie imię i nazwisko, nick, miejscowość, dwa numery kontaktowe, krótka biografia, zdjęcie profilowe, zdjęcie w tle i linki do Instagrama, TikToka, YouTube, Facebooka, X, LinkedIna oraz Twitcha. Imię, nazwisko, nick i zdjęcia są publiczne; dla pozostałych pól użytkownik wybiera widoczność: publicznie, tylko Ekipa lub prywatnie. Numery kontaktowe są domyślnie prywatne i nie zmieniają numeru logowania.
- Responsywny układ dla komputera i telefonu.

Uwierzytelnianie działa przez API: hasła są hashowane, adres e-mail wymaga potwierdzenia, a logowanie jest obecnie dostępne wyłącznie przez potwierdzony adres e-mail i hasło. Logowanie numerem telefonu oraz SMS jako dodatkowy kod przy logowaniu są tymczasowo wyłączone i można je później ponownie włączyć. W edycji profilu można zmienić numer logowania (potwierdzenie SMS-em) oraz e-mail logowania (potwierdzenie kodem wysłanym na nowy adres); numery kontaktowe w profilu pozostają odrębne. Opcja „Zapamiętaj mnie” utrzymuje sesję przez 30 dni; bez niej cookie sesji jest tymczasowe, a sesja wygasa po 12 godzinach. „Nie pamiętam hasła” pozwala wybrać wysłanie jednorazowego, sześciocyfrowego kodu na potwierdzony e-mail albo zweryfikowany numer telefonu. Kod wygasa po 10 minutach, a po 5 błędnych próbach jest odrzucany. Zmiana hasła unieważnia dotychczasowe sesje i zaufane urządzenia. W środowisku developerskim edytowalne dane profilu, w tym zdjęcia zmniejszane w przeglądarce, są zapisywane wraz z kontem w `data/auth-store.json`; na hostingu używana jest baza PostgreSQL skonfigurowana przez `DATABASE_URL`. Pozostałe dane społecznościowe nadal działają jako prototyp i są zapisywane w localStorage tej przeglądarki. Wybrana płeć jest zapisywana na koncie i używana do odmiany komunikatów aktywności; „Inna” oraz „Wolę nie podawać” używają neutralnych form. Do publikacji produkcyjnej potrzebne są HTTPS, trwała baza danych, bezpieczny magazyn sekretów oraz backend z kontrolą dostępu.

Zdjęcia profili i przykładowych postów są demonstracyjnymi zasobami Unsplash. Załączniki dodane przez użytkownika są wybierane z jego urządzenia.
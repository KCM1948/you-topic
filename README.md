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

Docelowy wariant testowy używa bezpłatnego serwisu webowego Render i PostgreSQL Neon. Darmowy serwis Render może usypiać się po okresie bezczynności, a darmowy plan bazy ma limity, które mogą się zmieniać — nie traktuj tego jako konfiguracji produkcyjnej. Po utworzeniu API trzeba dodać w Vercel przekierowanie `/api/*` do adresu API; dzięki temu sesja pozostaje na domenie aplikacji. Ustaw `APP_URL` i `APP_ORIGINS` na `https://you-topic.vercel.app`, `NODE_ENV=production`, `DATABASE_URL` z panelu Neon, `AUTH_SESSION_SECRET` wygenerowany osobno oraz `SMTP_URL` i `SMTP_FROM` dla poczty. Sekrety wpisuj wyłącznie w ustawieniach hostingu, nigdy w repozytorium ani w czacie. Nie kopiuj lokalnego `.env` ani `data/auth-store.json` do wdrożenia.

## Funkcje prototypu

- Ekran rejestracji z imieniem, nazwiskiem, płcią, datą urodzenia (minimum 15 lat), adresem e-mail, telefonem i hasłem. E-mail wymaga potwierdzenia. Logowanie jest obecnie dostępne wyłącznie przez e-mail i hasło; logowanie numerem telefonu oraz kod SMS przy nowym urządzeniu są tymczasowo wyłączone.
- Publiczny Chat dostępny dla wszystkich kont, prywatne Pokoje użytkowników oraz zaproszenia do Ekipy z akceptacją po drugiej stronie.
- Wiele prywatnych band: członkowie mają dostęp, mogą tworzyć własne bandy, zapraszać ekipowiczów, publikować posty i relacje, a admin ma niebieski badge.
- Prywatny feed bandy: wpisy tekstowe, zdjęcia, filmy i linki zewnętrzne; członkowie mogą lajkować i komentować, a posty można przypinać w Bandzie. Publiczne posty można udostępniać do bandy, nigdy odwrotnie na Tablicę.
- Licznik nieprzeczytanych postów, podgląd osób, które widziały wpis, i relacje wygasające po 24 godzinach.
- Dodawanie postów tekstowych oraz lokalnych zdjęć i krótkich filmów.
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
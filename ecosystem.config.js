// Konfiguracja pm2 dla Punktualnika.
//
// Wcześniej proces był uruchamiany ręcznie i nie istniał żaden plik, który by to
// opisywał — po awarii z 21.08.2026 okazało się, że logi nie mają nawet znaczników
// czasu, więc nie dało się powiedzieć, KIEDY cokolwiek się stało.
//
// Pierwsze uruchomienie na serwerze (nazwa procesu musi zostać ta sama, więc stary
// wpis trzeba usunąć, a nie restartować):
//
//   pm2 delete Punktualnik
//   pm2 start ecosystem.config.js
//   pm2 save
//
// Potem wystarczy `pm2 restart Punktualnik`.

module.exports = {
  apps: [
    {
      name: "Punktualnik",

      // Wołamy binarkę Next bezpośrednio, nie przez `npm start`. npm dokłada
      // własny proces pośredni, przez który sygnały (restart, stop) idą okrężną
      // drogą, a `pm2 describe` pokazuje pamięć powłoki zamiast aplikacji.
      script: "node_modules/next/dist/bin/next",
      args: "start",
      cwd: __dirname,

      // JEDNA instancja — bezwzględnie. Baza to plik SQLite, a każdy dodatkowy
      // proces to osobne połączenie i powrót dokładnie tego problemu, który
      // wywołał awarię (kolizje o blokadę zapisu zamrażające synchroniczne API
      // better-sqlite3). Skalowanie tej aplikacji nie idzie przez klaster.
      instances: 1,
      exec_mode: "fork",

      // Siatka bezpieczeństwa, nie rozwiązanie: kontener ma 1 GB i ZERO swapu,
      // więc OOM-killer ubija proces bez ostrzeżenia i bez wpisu w logu aplikacji.
      // Restart przy 700 MB pozwala pm2 zrobić to kontrolowanie i zostawić ślad.
      max_memory_restart: "700M",

      // Bez tego w logu nie ma czasu zdarzenia — dokładnie ta luka, przez którą
      // po awarii z 21.08 nie było czego czytać.
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      merge_logs: true,

      // Pętla restartów przy błędzie startu (np. zepsuty build) potrafi zająć CPU
      // na całą noc. Po 10 nieudanych próbach pm2 ma odpuścić i zostawić dowód.
      max_restarts: 10,
      min_uptime: "30s",
      restart_delay: 2000,

      env: {
        NODE_ENV: "production",
      },
    },
  ],
};

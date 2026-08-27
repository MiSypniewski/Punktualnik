module.exports = {
  reactStrictMode: true,
  i18n: {
    locales: ["pl"],
    defaultLocale: "pl",
  },
  // better-sqlite3 to moduł natywny — nie pakujemy go do bundla serwerowego,
  // ma być wymagany w runtime z node_modules.
  //
  // exceljs z tej samej listy, choć z innego powodu: paczka ma ponad 20 MB
  // kodu, a `next build` na produkcji mieści się w pamięci tylko przy włączonej
  // "amfetaminie". Przepuszczanie jej przez webpacka przy każdym buildzie to
  // koszt bez żadnego zysku — na serwerze i tak leży w node_modules.
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = [...config.externals, "better-sqlite3", "exceljs"];
    }
    return config;
  },
};

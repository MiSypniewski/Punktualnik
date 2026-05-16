module.exports = {
  reactStrictMode: true,
  i18n: {
    locales: ["pl"],
    defaultLocale: "pl",
  },
  // better-sqlite3 to moduł natywny — nie pakujemy go do bundla serwerowego,
  // ma być wymagany w runtime z node_modules.
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = [...config.externals, "better-sqlite3"];
    }
    return config;
  },
};

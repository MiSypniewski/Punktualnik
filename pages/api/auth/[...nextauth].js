import NextAuth from "next-auth";
// import Providers from "next-auth/providers";
import CredentialsProvider from "next-auth/providers/credentials";
// import authorizeUser from "services/users/authorize";
import authorizeUser from "../../../services/authorizeUser";
import { loadSessionUser, withCurrentUser } from "../../../services/session";
// import EmailProvider from "next-auth/providers/email";

export default NextAuth({
  // Własne ekrany zamiast wbudowanych stron next-auth.
  //
  // Bez tego każdy problem z logowaniem kończył się na /api/auth/error — surowej,
  // angielskiej stronie z jednym słowem "Error" i nazwą domeny. Użytkownik nie
  // dostawał żadnej wskazówki i nie miał nawet jak wrócić do formularza.
  // Teraz ląduje na własnym ekranie logowania, który tłumaczy kod błędu na polski.
  pages: {
    signIn: "/users/signin",
    error: "/users/signin",
  },
  // Configure one or more authentication providers
  providers: [
    CredentialsProvider({
      // The name to display on the sign in form (e.g. 'Sign in with...')
      name: "Credentials",
      // The credentials is used to generate a suitable form on the sign in page.
      // You can specify whatever fields you are expecting to be submitted.
      // e.g. domain, username, password, 2FA token, etc.
      credentials: {
        email: { label: "Email", type: "text", placeholder: "jsmith" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, req) {
        // Drugi argument to { query, body, headers, method } (next-auth 4.24,
        // core/routes/callback.js). NIE MA tu gniazda, więc adres klienta da się
        // wziąć wyłącznie z nagłówków — czyli jest podrabialny. Limiter po IP jest
        // z tego powodu tylko warstwą dodatkową; obroną właściwą jest kubełek po
        // adresie e-mail. Szczegóły w services/loginRateLimit.js.
        const user = await authorizeUser({
          email: credentials.email,
          password: credentials.password,
          headers: req?.headers,
        });

        if (user) {
          // Any object returned will be saved in `user` property of the JWT
          return user;
        } else {
          // If you return null or false then the credentials will be rejected
          return null;
          // You can also Reject this callback with an Error or with a URL:
          // throw new Error('error message') // Redirect to error page
          // throw '/path/to/redirect'        // Redirect to a URL
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.name = user?.name;
        token.role = user?.role;
        token.id = user?.id;
        token.section = user?.section;
        token.location = user?.location;
        token.userID = user?.userID;
        token.sv = user?.sessionVersion ?? 0;
        return token;
      }

      // Odświeżenie sesji (/api/auth/session, czyli useSession w przeglądarce).
      // Bez tego interfejs pokazywałby rolę z dnia logowania, a odnawiane
      // ciasteczko żyłoby dalej mimo dezaktywacji konta.
      //
      // Wyjątek jest tu sposobem na wylogowanie, nie awarią: next-auth 4
      // (core/routes/session.js) czyści wtedy ciasteczka sesji i zwraca pustą
      // sesję, więc strona przechodzi do ekranu logowania. API i tak już odmawia
      // (services/session.js: getActiveToken).
      const current = loadSessionUser(token);
      if (!current) {
        throw new Error("session_revoked");
      }
      return withCurrentUser(token, current);
    },

    async session({ session, token }) {
      session.user.role = token?.role;
      session.user.section = token?.section;
      session.user.id = token?.id;
      session.user.location = token?.location;
      session.user.userID = token?.userID;

      return session;
    },
  },
});

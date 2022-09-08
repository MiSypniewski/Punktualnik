import Link from "next/link";
import BaseLayout from "../components/baseLayout";
import { useSession } from "next-auth/react";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";

// const KonfiguracjaTabletaDLaFundacja = () => {
//   // poniżej linki do trzech elementów potrzebnych do konfiguracji tableta
//   // aktualnie nie używane
//   return (
//     <>
//       <Link href="https://drive.google.com/file/d/1P4WBxbB-dxMPKv8f26-_WFZ2hv0u03c9/view?usp=sharing">
//         <a
//           target="_blank"
//           rel="noreferrer"
//           className="block w-40 h-16 rounded-lg font-bold text-white text-center leading-10 text-lg shadow-lg mx-auto px-4 py-2 bg-green-600 hover:bg-green-700"
//         >
//           Tapeta
//         </a>
//       </Link>
//       <Link href="https://drive.google.com/file/d/1BM7vNgM6djdokPgp3aaF9aUzDPF9Ce5V/view?usp=sharing">
//         <a
//           target="_blank"
//           rel="noreferrer"
//           className="block w-40 h-16 rounded-lg font-bold text-white text-center leading-10 text-lg shadow-lg mx-auto px-4 py-2 bg-blue-600 hover:bg-blue-700"
//         >
//           Wygaszacz
//         </a>
//       </Link>
//       <Link href="https://drive.google.com/file/d/1Egsu6Ox7mxuDCG4R9WWalDrC0ftAmW9E/view?usp=sharing">
//         <a
//           target="_blank"
//           rel="noreferrer"
//           className="block w-40 h-16 rounded-lg font-bold text-white text-center leading-10 text-lg shadow-lg mx-auto px-4 py-2 bg-red-600 hover:bg-red-700"
//         >
//           Aplikacja
//         </a>
//       </Link>
//     </>
//   );
// };

export default function Home({}) {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "authenticated") {
      router.push(`/time/${session.user.section}`);
    }
  }, [session, status]);

  return (
    <BaseLayout>
      <div className="lg:container mx-auto bg-white">
        <h1 className="text-center font-bold text-3xl py-1 px-2">opss.pl</h1>
        <p>Zaraz zostaniesz przekierowany na odpowiednią sekcję</p>
        {/* <div className="lg:container mx-auto grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-3 gap-4 mt-1 p-2">
          <button
            onClick={() => {
              router.push("/users/register");
            }}
          >
            Rejestracja
          </button>
          <Link href="/time/biedronka">
            <a
              // target="_blank"
              // rel="noreferrer"
              className="block w-40 h-16 rounded-lg font-bold text-white text-center leading-10 text-lg shadow-lg mx-auto px-4 py-2 bg-red-600 hover:bg-red-700"
            >
              Biedronka
            </a>
          </Link>
        </div> */}
      </div>
    </BaseLayout>
  );
}

export default function Home() {
  return (
    <div className="lg:container mx-auto bg-white">
      <h1 className="text-center font-bold text-3xl py-1 px-2">Punktualnik</h1>
      <table className="table-fixed  text-center">
        <thead>
          <tr>
            <th className="w-2/5 px-3">Pracownik</th>
            <th className="w-2/5 px-3">Pozostały czas:</th>
            <th className="w-1/5 px-3">Przyjście:</th>
            <th className="w-1/5 px-3">Wyjście:</th>
          </tr>
        </thead>
        <tbody className="font-mono">
          <tr className="hover:bg-blue-300">
            <td className="py-3 ">Michał Sypniewski</td>
            <td>07:52:00</td>
            <td>
              <button className="block w-28 rounded-lg font-bold shadow-lg mx-auto px-4 py-2 bg-green-500 hover:bg-green-600">
                START
              </button>
            </td>
            <td>
              <button className="block w-28 rounded-lg font-bold shadow-lg mx-auto px-4 py-2 bg-red-500 hover:bg-red-600">
                STOP
              </button>
            </td>
          </tr>
          <tr className="hover:bg-blue-300">
            <td className="py-3 ">Jacek Tomczak</td>
            <td>07:52:00</td>
            <td>
              <button className="block w-20 rounded-lg font-bold shadow-lg mx-auto px-4 py-1 bg-green-500 hover:bg-green-600">
                06:45
              </button>
            </td>
            <td>
              <button className="block w-20 rounded-lg font-bold shadow-lg mx-auto px-4 py-1 bg-red-500 hover:bg-red-600">
                STOP
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <div className="my-56 grid grid-cols-3 gap-2">
        <div className="w-full h-40 rounded-lg bg-blue-300 text-center p-2">
          <h2 className="py-1 text-2xl">Jacek Tomczak</h2>
          <p className="py-1 text-4xl">07:35:00</p>
          <div className="flex py-3">
            <button className="block w-20 rounded-lg font-bold shadow-lg mx-auto px-4 py-1 bg-green-500 hover:bg-green-600">
              START
            </button>
            <button className="block w-20 rounded-lg font-bold shadow-lg mx-auto px-4 py-1 bg-red-500 hover:bg-red-600">
              STOP
            </button>
          </div>
        </div>
        <div className="w-full h-40 rounded-lg bg-blue-300 text-center p-2">
          <h2 className="py-1 text-2xl">Jacek Tomczak</h2>
          <p className="py-1 text-4xl">07:35:00</p>
          <div className="flex py-3">
            <button className="block w-20 rounded-lg font-bold shadow-lg mx-auto px-4 py-1 bg-green-500 hover:bg-green-600">
              START
            </button>
            <button className="block w-20 rounded-lg font-bold shadow-lg mx-auto px-4 py-1 bg-red-500 hover:bg-red-600">
              STOP
            </button>
          </div>
        </div>
        <div className="w-full h-40 rounded-lg bg-blue-300 text-center p-2">
          <h2 className="py-1 text-2xl">Jacek Tomczak</h2>
          <p className="py-1 text-4xl">07:35:00</p>
          <div className="flex py-3">
            <button className="block w-20 rounded-lg font-bold shadow-lg mx-auto px-4 py-1 bg-green-500 hover:bg-green-600">
              START
            </button>
            <button className="block w-20 rounded-lg font-bold shadow-lg mx-auto px-4 py-1 bg-red-500 hover:bg-red-600">
              STOP
            </button>
          </div>
        </div>
        <div className="w-full h-40 rounded-lg bg-blue-300 text-center p-2">
          <h2 className="py-1 text-2xl">Jacek Tomczak</h2>
          <p className="py-1 text-4xl">07:35:00</p>
          <div className="flex py-3">
            <button className="block w-20 rounded-lg font-bold shadow-lg mx-auto px-4 py-1 bg-green-500 hover:bg-green-600">
              START
            </button>
            <button className="block w-20 rounded-lg font-bold shadow-lg mx-auto px-4 py-1 bg-red-500 hover:bg-red-600">
              STOP
            </button>
          </div>
        </div>
        <div className="w-full h-40 rounded-lg bg-blue-300 text-center p-2">
          <h2 className="py-1 text-2xl">Jacek Tomczak</h2>
          <p className="py-1 text-4xl">07:35:00</p>
          <div className="flex py-3">
            <button className="block w-28 rounded-lg font-bold shadow-lg mx-auto px-4 py-2 bg-green-500 hover:bg-green-600">
              START
            </button>
          </div>
        </div>
        <div className="w-full h-40 rounded-lg bg-blue-300 text-center p-2">
          <h2 className="py-1 text-2xl">Jacek Tomczak</h2>
          <p className="py-1 text-4xl">07:35:00</p>
          <div className="flex py-3">
            <button className="block w-28 rounded-lg font-bold shadow-lg mx-auto px-4 py-2 bg-red-500 hover:bg-red-600">
              STOP
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

import Person from "../components/person";
import Clock from "../components/clock";

export default function Home() {
  const userList = [
    "Grzegorz Sobstyl ",
    "Kamil Milczarek",
    "Radosław Przybyła",
    "Michał Sypniewski",
    "Łukasz Baranowski",
    "Łukasz Grześkowiak",
    "Rafał Kuźma",
    "Piotr Szulkowski",
    "Mateusz Mikołajczak",
    "Szymon Ziemak",
  ];
  return (
    <div className="lg:container mx-auto bg-white">
      {/* <h1 className="text-center font-bold text-3xl py-1 px-2">Punktualnik</h1> */}
      {/* <p className="text-center">13-10-2021 09:11</p> */}
      <div className="grid grid-cols-3 gap-4 mt-4">
        {userList.map((user) => (
          <Person name={user} key={user} />
        ))}
      </div>
      {/* <div className="grid grid-cols-3 gap-4 justify-items-center mt-4">
        {userList.map((user) => (
          <Clock name={user} key={user} />
        ))}
      </div> */}
    </div>
  );
}

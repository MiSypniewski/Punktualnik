import { useState } from "react";

const Clock = ({ name }) => {
  const [status, setStatus] = useState("PRZYJŚCIE");

  const changeStatus = (status) => {
    if (status === "PRZYJŚCIE") setStatus("WCZEŚNIEJSZE WYJŚCIE");
    if (status === "WCZEŚNIEJSZE WYJŚCIE") setStatus("WYJŚCIE");
  };

  return (
    <div className="flex flex-col justify-content-center place-content-center rounded-full min-h-full  w-60 h-60 bg-gray-200 border-4 border-green-500">
      <p className="block w-full text-center">{name}</p>
      <p className="block w-full text-center">07:00:00</p>
    </div>
  );
};

export default Clock;

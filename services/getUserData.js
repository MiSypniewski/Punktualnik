import db from "./db";

const stmt = db.prepare(`SELECT * FROM Users WHERE id = ?`);

const getUserData = async (userID) => {
  const user = stmt.get(Number(userID));
  if (!user) return [];

  return [
    {
      ...user,
      ID: user.id,
      passwordHash: ";)",
      passwordSalt: ";)",
    },
  ];
};

export default getUserData;

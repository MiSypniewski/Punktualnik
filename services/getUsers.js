import db from "./db";

const stmt = db.prepare(
  `SELECT * FROM Users WHERE section = ? AND role = 'user' AND isActive = 1`
);

const getUsers = async (section) => {
  const users = stmt.all(section);

  return users.map((user) => ({
    ...user,
    ID: user.id,
    passwordHash: ";)",
    passwordSalt: ";)",
    email: ";)",
  }));
};

export default getUsers;

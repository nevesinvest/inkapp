const jwt = require("jsonwebtoken");
const { JWT_SECRET } = require("../config/env");
const { unauthorized, forbidden } = require("../utils/http");

function signAccessToken(user) {
  return jwt.sign(
    {
      id: user.id,
      role: user.role,
      name: user.name,
      email: user.email
    },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function authenticate(req, res, next) {
  const header = req.headers.authorization || "";
  const [type, token] = header.split(" ");

  if (type !== "Bearer" || !token) {
    return unauthorized(res);
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    return next();
  } catch (error) {
    return unauthorized(res, "Token inválido ou expirado.");
  }
}

function requireRoles(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return unauthorized(res);
    }

    if (!roles.includes(req.user.role)) {
      return forbidden(res);
    }

    return next();
  };
}

module.exports = {
  authenticate,
  requireRoles,
  signAccessToken
};

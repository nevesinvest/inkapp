function badRequest(res, message) {
  return res.status(400).json({ message });
}

function unauthorized(res, message = "Não autenticado.") {
  return res.status(401).json({ message });
}

function forbidden(res, message = "Acesso negado.") {
  return res.status(403).json({ message });
}

function notFound(res, message = "Recurso não encontrado.") {
  return res.status(404).json({ message });
}

module.exports = {
  badRequest,
  unauthorized,
  forbidden,
  notFound
};

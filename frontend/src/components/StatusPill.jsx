const statusMap = {
  pending: "Pendente",
  confirmed: "Confirmado",
  cancelled: "Cancelado",
  completed: "Concluído",
  reviewing: "Em análise",
  replied: "Respondido",
  accepted: "Aceito",
  rejected: "Recusado",
  paid: "Pago",
  received: "Recebido",
  overdue: "Vencido",
  refunded: "Reembolsado"
};

export function StatusPill({ status }) {
  return <span className={`status-pill status-${status}`}>{statusMap[status] || status}</span>;
}

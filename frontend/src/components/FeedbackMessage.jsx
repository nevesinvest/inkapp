export function FeedbackMessage({ message, type = "info" }) {
  if (!message) return null;

  return <p className={`feedback-message feedback-${type}`}>{message}</p>;
}

import { GAMEDAY_CONFIG } from './gameday-config.js';
const status = document.getElementById('help-status');
const preview = document.getElementById('help-preview');
const topic = document.getElementById('help-topic');
const receipt = document.getElementById('help-receipt');
const details = document.getElementById('help-details');
const supportContact = document.getElementById('support-contact');
const supportEmail = String(GAMEDAY_CONFIG.support?.email || '').trim();
const safeEmail = /^[^\s@?&#]+@[^\s@?&#]+\.[^\s@?&#]+$/.test(supportEmail) ? supportEmail : null;
const problemDetails = () => `GameDay test app — ${topic.value}\nDate: ${new Date().toISOString()}\nTicket or receipt: ${receipt.value.trim() || 'Not provided'}\nProblem: ${details.value.trim() || 'Not provided'}\nEnvironment: TEST MODE — no real money`;
const updateContact = () => {
  if (!safeEmail) return;
  supportContact.href = `mailto:${encodeURIComponent(safeEmail)}?subject=${encodeURIComponent(`GameDay help: ${topic.value}`)}&body=${encodeURIComponent(problemDetails())}`;
};
if (safeEmail) {
  document.getElementById('contact-guidance').textContent = 'If an issue continues, send the details below to GameDay support. Your email app will open so you can review the message before sending it.';
  supportContact.textContent = `Email support: ${safeEmail}`;
  supportContact.hidden = false;
  [topic, receipt, details].forEach(control => control.addEventListener('input', updateContact));
  supportContact.addEventListener('click', updateContact);
  updateContact();
}
document.getElementById('help-copy').addEventListener('click', async () => {
  const report = problemDetails();
  preview.textContent = report;
  preview.hidden = false;
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
    await navigator.clipboard.writeText(report);
    status.textContent = 'Problem details copied. Review them before sharing. Nothing has been sent.';
    status.classList.remove('error');
  } catch {
    status.textContent = 'Copy is unavailable in this browser. Select and copy the problem details shown below. Nothing has been sent.';
    status.classList.add('error');
  }
});

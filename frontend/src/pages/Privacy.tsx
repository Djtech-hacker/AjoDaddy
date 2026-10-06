import LegalLayout from '../components/LegalLayout'

export default function Privacy() {
  return (
    <LegalLayout title="Privacy Policy" updated="[DATE]">
      <p>This policy explains how Banji Digital Technologies ("we", "us"), the operator of AjoDaddy, collects and uses your personal data in line with the Nigeria Data Protection Act 2023.</p>

      <h2>1. Data we collect</h2>
      <ul>
        <li>Account details: name, email address, phone number, username, password (stored hashed).</li>
        <li>Identity verification data: BVN, NIN and a face image, used to verify who you are.</li>
        <li>Financial details: bank account details you add, wallet balance, contributions, payouts and transaction history.</li>
        <li>Group activity: groups you join or create, messages in group chat.</li>
        <li>Technical data: device and session information used to keep your account secure.</li>
      </ul>

      <h2>2. Why we use it</h2>
      <ul>
        <li>To create and secure your account and verify your identity.</li>
        <li>To process contributions, withdrawals and payouts.</li>
        <li>To send one-time passwords, receipts and reminders by SMS and email.</li>
        <li>To prevent fraud and meet legal obligations.</li>
      </ul>

      <h2>3. Who we share it with</h2>
      <p>We share data only as needed with service providers that help us run AjoDaddy, including payment processors (Paystack, Flutterwave), identity verification providers, our database host (Supabase), and SMS/email providers. Other members of your group can see your name, profile and contribution status. We do not sell your personal data.</p>

      <h2>4. Retention and security</h2>
      <p>We keep your data for as long as your account is active and as required by law. We use encrypted connections and access controls to protect it. No system is completely secure, so please keep your password and PIN private.</p>

      <h2>5. Your rights</h2>
      <p>You may ask to access, correct, delete or restrict the use of your personal data, to object to processing, and to withdraw consent, subject to legal retention requirements. You can also complain to the Nigeria Data Protection Commission.</p>

      <h2>6. Contact</h2>
      <p>For privacy requests, email [SUPPORT EMAIL].</p>
    </LegalLayout>
  )
}
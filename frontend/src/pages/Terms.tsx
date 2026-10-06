import LegalLayout from '../components/LegalLayout'

export default function Terms() {
  return (
    <LegalLayout title="Terms of Service" updated="[DATE]">
      <p>
        These Terms of Service ("Terms") govern your use of AjoDaddy, a product of Banji Digital
        Technologies (Business Name Registration No. 9693887) ("AjoDaddy", "we", "us"). By creating an
        account or using AjoDaddy, you agree to these Terms. If you do not agree, do not use the service.
      </p>

      <h2>1. What AjoDaddy is</h2>
      <p>
        AjoDaddy is a software platform that helps groups of people organise rotating savings (Ajo,
        Esusu or Susu). We provide tools to create groups, track contributions, schedule payouts and
        keep a record of activity. AjoDaddy is a technology provider. We are not a bank, we are not a
        member of any group, and we do not guarantee that any member will make their contributions.
      </p>

      <h2>2. Eligibility and your account</h2>
      <ul>
        <li>You must be at least 18 years old and legally able to enter a binding agreement.</li>
        <li>You must give accurate information and complete identity verification (including BVN and NIN) before using payment features.</li>
        <li>You are responsible for keeping your password, OTP codes and transaction PIN private. Anything done with your credentials is treated as done by you.</li>
        <li>You may only have one account. Creating another account to avoid a debt or removal is prohibited.</li>
      </ul>

      <h2>3. Groups: private and public</h2>
      <p>
        Groups on AjoDaddy are created and run by their members. AjoDaddy does not create, manage,
        vouch for or supervise any group, and we do not select or screen group members.
      </p>
      <ul>
        <li><strong>Private groups</strong> are joined by invite from someone you know. We strongly advise using private groups and only saving with people you personally know and trust.</li>
        <li><strong>Public groups</strong> may include people you do not know. Joining a public group, or any group with strangers, is entirely at your own risk.</li>
      </ul>

      <h2>4. Risk of loss and scams</h2>
      <p>
        Every rotating savings arrangement carries risk. A member who receives a payout early may stop
        contributing afterwards, and other members may lose money. People may also pretend to be
        someone they are not, or use a group to deceive others.
      </p>
      <ul>
        <li>AjoDaddy is not responsible or liable for any loss, fraud, scam, default or dispute between members, including in public groups and groups with people you do not know.</li>
        <li>We do not guarantee that you will receive a payout, recover money, or be repaid by another member.</li>
        <li>Our verification tools (NIN/BVN checks, the 48-hour grace period, automatic removal and debt tracking) make default harder but do not guarantee protection.</li>
        <li>Before joining, check who the group admin and members are, and never send money or personal details to anyone outside the platform because of a group.</li>
      </ul>
      <p>
        Nothing in these Terms excludes or limits liability that cannot be excluded under Nigerian law,
        such as liability for our own fraud or wilful misconduct.
      </p>

      <h2>5. Contributions, payouts and penalties</h2>
      <ul>
        <li>Each group sets its own contribution amount, frequency, payout order and late-payment rules. You agree to the rules shown to you before you join.</li>
        <li>Contributions are processed through third-party payment providers (currently Paystack and Flutterwave). Their terms also apply to payments.</li>
        <li>If a member misses a scheduled contribution, the group may be paused and members notified. The member has 48 hours to pay. If they do not, they may be removed from the group and the unpaid amount recorded as a debt on their account, which must be settled before they can use some features again.</li>
        <li>Payouts are sent to the bank account on your profile. You are responsible for making sure your bank details are correct. We are not liable for transfers sent to details you provided.</li>
        <li>Fees: [DESCRIBE ANY FEES, e.g. withdrawal fees and platform fees, OR state "AjoDaddy currently charges no platform fee"]. Payment providers may charge their own fees.</li>
      </ul>

      <h2>6. Identity verification and debts</h2>
      <p>
        You consent to us verifying your identity using your BVN, NIN and a face image through
        approved verification providers. Debts recorded on your account remain owed even if you leave a
        group, and we may restrict your account until they are settled.
      </p>

      <h2>7. Acceptable use</h2>
      <ul>
        <li>No fraud, money laundering, terrorist financing or use of another person's identity or accounts.</li>
        <li>No harassment, hate speech, threats or unlawful content in group chat.</li>
        <li>No attempts to hack, disrupt or misuse the platform, or to bypass verification or limits.</li>
        <li>No using AjoDaddy to collect money from people for purposes other than the group you created.</li>
      </ul>
      <p>
        We may warn, suspend, ban or close accounts, freeze or close groups, and hold or reverse
        transactions where we believe these Terms or the law have been broken, or to comply with a legal
        or regulatory request.
      </p>

      <h2>8. Disputes</h2>
      <p>
        If you have a problem with a payment or another member, raise a dispute in the app or contact
        [SUPPORT EMAIL]. We will review what we can see on the platform and may take action on accounts
        or transactions, but we are not a court or arbitrator. We cannot force a member to pay, and
        recovering money from another member is your responsibility, including through lawful means
        outside AjoDaddy.
      </p>

      <h2>9. Our liability</h2>
      <p>
        To the fullest extent permitted by law, AjoDaddy is provided "as is" and we are not liable for:
      </p>
      <ul>
        <li>losses caused by other members, including default, fraud, scams or misrepresentation;</li>
        <li>outages, delays or errors of banks, payment providers, telecom networks or other third parties;</li>
        <li>losses from sharing your login details, OTP or PIN, or from incorrect bank details you entered;</li>
        <li>indirect or consequential losses, or lost profits or savings goals.</li>
      </ul>
      <p>Where we are found liable, our liability is limited to the fees you paid us in the 6 months before the claim, to the extent the law allows.</p>

      <h2>10. Privacy</h2>
      <p>Our Privacy Policy explains how we collect and use your data. By using AjoDaddy you agree to it.</p>

      <h2>11. Changes, ending your account and governing law</h2>
      <p>
        We may update these Terms and will tell you about material changes. Continuing to use AjoDaddy
        after a change means you accept it. You may close your account at any time once you have no
        unpaid contributions or debts. These Terms are governed by the laws of the Federal Republic of
        Nigeria, and the courts of Lagos State have jurisdiction.
      </p>

      <h2>12. Contact</h2>
      <p>Banji Digital Technologies, [FULL STREET ADDRESS], Ikeja, Lagos State, Nigeria. Email: [SUPPORT EMAIL].</p>
    </LegalLayout>
  )
}
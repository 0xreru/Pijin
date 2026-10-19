import type { Metadata } from 'next';
import {
  Database,
  Eye,
  KeyRound,
  Link2,
  Lock,
  Mail,
  Server,
  Smartphone,
  Timer,
  Users,
  Baby,
  FlaskConical,
  RefreshCw,
  Scale,
  ShieldOff,
} from 'lucide-react';
import { LegalPage, LegalSection, LegalHighlights, LegalTable } from '../components/LegalPage';

export const metadata: Metadata = {
  title: 'Privacy Policy · Pijin',
  description: 'How the Pijin app collects, uses, shares and protects your information.',
};

const SUPPORT_EMAIL = 'support.pijin@gmail.com';

export default function PrivacyPolicyPage() {
  return (
    <LegalPage
      eyebrow="Legal"
      title="Privacy Policy"
      updated="October 20, 2026"
      intro={
        <p>
          This Privacy Policy explains how Pijin (&quot;Pijin&quot;, &quot;we&quot;, &quot;us&quot;) collects, uses,
          shares and protects your information when you use the Pijin mobile app and the pijin.live website.
          By using Pijin, you agree to the practices described here.
        </p>
      }
    >
      <LegalHighlights
        items={[
          {
            icon: <ShieldOff className="h-5 w-5" />,
            title: 'We never sell your data',
            text: 'No ads and no analytics or advertising trackers in the app.',
          },
          {
            icon: <KeyRound className="h-5 w-5" />,
            title: 'Your keys stay with you',
            text: 'Private keys and your recovery phrase never leave your phone.',
          },
          {
            icon: <Mail className="h-5 w-5" />,
            title: 'Delete anytime',
            text: 'Request account deletion and we remove your data within 30 days.',
          },
        ]}
      />

      <LegalSection icon={<Database className="h-5 w-5" />} title="1. Information we collect">
        <p>We collect only what we need to run your wallet and process your payments:</p>
        <LegalTable
          rows={[
            { label: 'Account details', detail: 'First name, last name, email address and mobile phone number, provided when you create an account.' },
            { label: 'PIN', detail: 'Stored on our servers only as a one-way scrypt hash. We never store or return your PIN in readable form.' },
            { label: 'Wallet identifiers', detail: 'Your Stellar wallet public key, your Pijin Short ID, and the public key your device uses to sign offline payments.' },
            { label: 'Transaction records', detail: 'The sender and receiver, amount, status, transaction reference and time of each payment, deposit or withdrawal.' },
            { label: 'Offline (SMS) payments', detail: 'When a payment is sent by text message, our SMS gateway receives the sending phone number and the signed payment message.' },
            { label: 'Verification codes', detail: 'One-time codes sent to your phone are stored for no more than 5 minutes.' },
            { label: 'Technical data', detail: 'Your IP address and phone number are used briefly to apply rate limits that protect the service from abuse.' },
          ]}
        />
      </LegalSection>

      <LegalSection icon={<Smartphone className="h-5 w-5" />} title="2. Information that stays on your device">
        <p>Some information never leaves your phone, and we cannot access it:</p>
        <ul>
          <li>Your wallet private keys and your 12-word recovery phrase.</li>
          <li>The local copy of your PIN, kept in your device&apos;s secure storage.</li>
          <li>Your local transaction history, used so the app works without internet.</li>
          <li>
            Camera images used to scan QR codes. They are processed on your device and are not uploaded. QR images
            are saved to your gallery only when you choose to save them.
          </li>
        </ul>
        <p>
          Because we never receive your private keys or recovery phrase, we cannot recover them for you. Keep your
          recovery phrase safe and never share it with anyone, including people claiming to be from Pijin.
        </p>
      </LegalSection>

      <LegalSection icon={<Eye className="h-5 w-5" />} title="3. How we use your information">
        <ul>
          <li>To create, secure and manage your account and verify your phone number.</li>
          <li>To process, settle and record your payments, online and offline.</li>
          <li>To show the recipient&apos;s name before you confirm a payment.</li>
          <li>To send you SMS verification codes and payment receipts.</li>
          <li>To prevent fraud, abuse and duplicate payments, and to keep the service secure.</li>
          <li>To respond to your support requests.</li>
        </ul>
        <p>
          <strong>We do not sell your personal information, we do not show ads, and the app does not include
          analytics or advertising trackers.</strong>
        </p>
      </LegalSection>

      <LegalSection icon={<Users className="h-5 w-5" />} title="4. What other users can see">
        <p>
          When someone enters your phone number or Short ID to send you money, Pijin shows them your
          <strong> first and last name and Short ID</strong> so they can confirm they are paying the right person.
          Payment receipts also show the names of the sender and receiver.
        </p>
      </LegalSection>

      <LegalSection icon={<Link2 className="h-5 w-5" />} title="5. Public blockchain records">
        <p>
          Pijin settles payments on the Stellar network. Wallet public keys, the Short ID registry, payment amounts
          and transaction history recorded on Stellar are <strong>public and permanent</strong>. They are not linked to
          your name, email or phone number on the blockchain, but they cannot be changed or deleted by anyone,
          including Pijin.
        </p>
      </LegalSection>

      <LegalSection icon={<Server className="h-5 w-5" />} title="6. Service providers">
        <p>
          We use trusted providers that process data on our behalf, only to run Pijin:
        </p>
        <ul>
          <li><strong>Vercel</strong>, for hosting our website and servers.</li>
          <li><strong>A cloud PostgreSQL database provider</strong>, for storing account and transaction records.</li>
          <li><strong>Upstash</strong>, for temporary storage of verification codes, rate limits and our payment queue.</li>
          <li><strong>TextBee</strong>, our SMS gateway for verification codes, receipts and offline payments.</li>
          <li><strong>The Stellar network</strong>, for settling and recording payments.</li>
        </ul>
        <p>
          We may also disclose information if required by law, or to protect the rights, safety and security of
          our users and the service.
        </p>
      </LegalSection>

      <LegalSection icon={<Lock className="h-5 w-5" />} title="7. How we protect your information">
        <ul>
          <li>All data between the app and our servers is encrypted in transit using HTTPS.</li>
          <li>PINs are stored only as hashes, and repeated wrong attempts lock the account temporarily.</li>
          <li>Private keys are kept in your device&apos;s secure storage and never sent to us.</li>
          <li>Screenshots are blocked on sensitive screens, and app data is excluded from device backups.</li>
          <li>Requests are rate-limited to protect against abuse.</li>
        </ul>
        <p>No system is completely secure, but we work to protect your information and review our safeguards regularly.</p>
      </LegalSection>

      <LegalSection icon={<Timer className="h-5 w-5" />} title="8. How long we keep your information">
        <ul>
          <li><strong>Account details:</strong> kept while your account is active, and deleted within 30 days after you request deletion.</li>
          <li><strong>Transaction and settlement records:</strong> kept for up to 5 years for fraud prevention and legal compliance.</li>
          <li><strong>Verification codes:</strong> deleted automatically after 5 minutes.</li>
          <li><strong>Blockchain records:</strong> permanent, as explained in section 5.</li>
        </ul>
      </LegalSection>

      <LegalSection id="your-rights" icon={<Scale className="h-5 w-5" />} title="9. Your rights and choices">
        <p>
          Under the Philippine Data Privacy Act of 2012 (Republic Act No. 10173) and other applicable laws, you have the
          right to be informed about, access, correct, object to the processing of, and request deletion of your
          personal information.
        </p>
        <p>
          To delete your account and its data, follow the steps on our{' '}
          <a href="/delete-account">Delete Account</a> page. For any other request, email us at{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>. If you believe your data privacy rights have been
          violated, you may also file a complaint with the National Privacy Commission of the Philippines.
        </p>
      </LegalSection>

      <LegalSection icon={<Baby className="h-5 w-5" />} title="10. Children">
        <p>
          Pijin is not intended for anyone under 18 years old, and we do not knowingly collect information from
          children. If you believe a child has created an account, contact us and we will delete it.
        </p>
      </LegalSection>

      <LegalSection icon={<FlaskConical className="h-5 w-5" />} title="11. Test release">
        <p>
          Pijin is currently in testing and runs on the Stellar test network. Balances in the test version have no real
          monetary value. We will update this policy before Pijin handles real money.
        </p>
      </LegalSection>

      <LegalSection icon={<RefreshCw className="h-5 w-5" />} title="12. Changes to this policy">
        <p>
          We may update this Privacy Policy from time to time. When we do, we will change the &quot;Last updated&quot;
          date above, and for significant changes we will notify you in the app or by other means.
        </p>
      </LegalSection>

      <LegalSection icon={<Mail className="h-5 w-5" />} title="13. Contact us">
        <p>
          Questions about this policy or your data? Email us at{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
        </p>
      </LegalSection>
    </LegalPage>
  );
}

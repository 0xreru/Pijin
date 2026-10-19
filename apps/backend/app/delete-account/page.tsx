import type { Metadata } from 'next';
import { AlertTriangle, Archive, HelpCircle, ShieldCheck, Trash2 } from 'lucide-react';
import { LegalPage, LegalSection, LegalCallout } from '../components/LegalPage';

export const metadata: Metadata = {
  title: 'Delete Your Account · Pijin',
  description: 'How to request deletion of your Pijin account and the data associated with it.',
};

const SUPPORT_EMAIL = 'support.pijin@gmail.com';
const DELETION_MAILTO = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Account Deletion Request')}`;

export default function DeleteAccountPage() {
  return (
    <LegalPage
      eyebrow="Account"
      title="Delete Your Pijin Account"
      updated="October 20, 2026"
      intro={
        <p>
          You can ask us to delete your Pijin account and the personal data associated with it at any time. This page
          explains how to make a request, what we delete, and what we are required to keep.
        </p>
      }
    >
      <LegalCallout icon={<ShieldCheck className="h-5 w-5" />} title="How to request account deletion">
        <ol>
          <li>
            Send an email to <a href={DELETION_MAILTO}>{SUPPORT_EMAIL}</a> from the email address registered to your
            Pijin account, with the subject <strong>&quot;Account Deletion Request&quot;</strong>.
          </li>
          <li>Include your <strong>full name</strong> and the <strong>mobile number</strong> registered to your account.</li>
          <li>
            We will reply to confirm that the account belongs to you. <strong>We will never ask for your PIN or your
            recovery phrase.</strong>
          </li>
          <li>Your account will be deleted within <strong>30 days</strong>, and we will email you when it is done.</li>
        </ol>
      </LegalCallout>

      <LegalSection icon={<AlertTriangle className="h-5 w-5" />} title="Before you request deletion">
        <ul>
          <li>
            <strong>Move your balance out first.</strong> After your account is deleted, you will no longer be able to
            use Pijin to access any remaining balance.
          </li>
          <li>
            <strong>Uninstalling the app does not delete your account.</strong> You must send a deletion request as
            described above.
          </li>
          <li>Account deletion is permanent and cannot be undone.</li>
        </ul>
      </LegalSection>

      <LegalSection icon={<Trash2 className="h-5 w-5" />} title="What we delete">
        <ul>
          <li>Your first name, last name, email address and mobile phone number.</li>
          <li>Your PIN hash.</li>
          <li>Your account profile, including your Short ID and registered device key.</li>
        </ul>
      </LegalSection>

      <LegalSection icon={<Archive className="h-5 w-5" />} title="What we keep">
        <ul>
          <li>
            <strong>Transaction and settlement records</strong> are kept for up to <strong>5 years</strong> for fraud
            prevention and legal compliance, and are then deleted.
          </li>
          <li>
            <strong>Records on the Stellar blockchain</strong>, such as wallet public keys and past payments, are public
            and permanent. They cannot be deleted by anyone, including Pijin.
          </li>
        </ul>
      </LegalSection>

      <LegalSection icon={<HelpCircle className="h-5 w-5" />} title="Questions">
        <p>
          For more about how we handle your data, read our <a href="/privacy-policy">Privacy Policy</a>, or email us
          at <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
        </p>
      </LegalSection>
    </LegalPage>
  );
}

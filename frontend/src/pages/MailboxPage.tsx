import React, { useEffect, useContext } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import EmailList from '../components/EmailList';
import { MailboxContext } from '../contexts/MailboxContext';
import Container from '../components/Container';

const MailboxPage: React.FC = () => {
  const { address } = useParams<{ address: string }>();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const {
    mailbox,
    isLoading,
    emails,
    selectedEmail,
    setSelectedEmail,
    isEmailsLoading,
    loadMailboxByAddress,
    showErrorMessage,
  } = useContext(MailboxContext);

  useEffect(() => {
    if (!address) return;

    // Extract local part if full email is provided (e.g., abc@test.com -> abc)
    const localPart = address.includes('@') ? address.split('@')[0] : address;

    // If the current mailbox already matches, no need to reload
    if (mailbox?.address === localPart) return;

    const load = async () => {
      const success = await loadMailboxByAddress(localPart);
      if (!success) {
        showErrorMessage(t('mailbox.invalidAddress'));
        setTimeout(() => navigate('/'), 2000);
      }
    };
    load();
  }, [address]);

  if (isLoading) {
    return (
      <Container>
        <div className="flex justify-center items-center min-h-[50vh]">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        </div>
      </Container>
    );
  }

  return (
    <Container>
      <EmailList
        emails={emails}
        selectedEmailId={selectedEmail}
        onSelectEmail={setSelectedEmail}
        isLoading={isEmailsLoading}
      />
    </Container>
  );
};

export default MailboxPage;

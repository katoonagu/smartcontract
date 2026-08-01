alter table address_labels drop constraint if exists address_labels_label_check;
alter table address_labels
  add constraint address_labels_label_check
  check (label in (
    'scam', 'reported_scam', 'victim', 'stolen_funds', 'phishing', 'mule', 'collector', 'bridge', 'exchange',
    'trusted', 'false_positive', 'needs_review', 'mixer_like',
    'risky_contract', 'whitebit', 'darknet_exchange', 'darknet_exchange_proximity',
    'approval_drain_proximity'
  ));

alter table transaction_labels drop constraint if exists transaction_labels_label_check;
alter table transaction_labels
  add constraint transaction_labels_label_check
  check (label in (
    'scam', 'reported_scam', 'victim', 'stolen_funds', 'phishing', 'mule', 'collector', 'bridge', 'exchange',
    'trusted', 'false_positive', 'needs_review', 'mixer_like',
    'risky_contract', 'whitebit', 'darknet_exchange', 'darknet_exchange_proximity',
    'approval_drain_proximity'
  ));

alter table address_label_assertions drop constraint if exists address_label_assertions_label_check;
alter table address_label_assertions
  add constraint address_label_assertions_label_check
  check (label in (
    'scam', 'reported_scam', 'victim', 'stolen_funds', 'phishing', 'mule', 'collector', 'bridge', 'exchange',
    'trusted', 'false_positive', 'needs_review', 'mixer_like',
    'risky_contract', 'whitebit', 'darknet_exchange', 'darknet_exchange_proximity',
    'approval_drain_proximity'
  ));

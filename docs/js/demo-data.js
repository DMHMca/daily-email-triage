/**
 * Realistic UK Preview Inbox (Sample Threads)
 * Used in Preview Mode before Google OAuth is connected so David can verify
 * every feature immediately (triage rules, dictation, drafting, tabs, export, audit log).
 * Contains both vetted active threads AND threads that should be excluded by the engine.
 */

export function buildDemoRawThreads(userEmail = 'david.mcaughtry@example.co.uk', nowMs = Date.now()) {
  const hoursAgo = (h) => nowMs - h * 60 * 60 * 1000;

  return [
    // --- SHOULD BE INCLUDED (Vetted Active Threads) ---
    {
      id: 'demo-thread-1',
      messages: [
        {
          id: 'demo-msg-1',
          dateMs: hoursAgo(3),
          labels: ['INBOX', 'UNREAD'],
          headers: {
            From: 'Sarah Jenkins <sarah.jenkins@harbourarchitects.co.uk>',
            To: `David McAughtry <${userEmail}>`,
            Subject: 'Garden studio drawings — quick question before Friday',
            'Message-ID': '<demo-1@harbourarchitects.co.uk>',
          },
          snippet: 'Hi David, we have updated the roof pitch on drawing A-04. Could you confirm whether you are happy with the revised cedar cladding before we submit to the council on Friday?',
          bodyText:
            'Hi David,\n\nHope you are having a good week. We have updated the roof pitch on drawing A-04 as discussed last Tuesday.\n\nCould you please confirm whether you are happy with the revised cedar cladding option and let us know if Thursday at 10:30 works for a brief call before we submit to the council on Friday?\n\nBest wishes,\nSarah',
        },
      ],
    },
    {
      id: 'demo-thread-2',
      messages: [
        {
          id: 'demo-msg-2',
          dateMs: hoursAgo(14),
          labels: ['INBOX'],
          headers: {
            From: 'Cotswold Heating Services <enquiries@cotswoldheating.co.uk>',
            To: `David McAughtry <${userEmail}>`,
            Subject: 'Annual boiler service — preferred morning slot next week',
            'Message-ID': '<demo-2@cotswoldheating.co.uk>',
          },
          snippet: 'Dear Mr McAughtry, your annual boiler service is due next week. Would Tuesday 08:30–11:00 or Wednesday 09:00–12:00 suit you best?',
          bodyText:
            'Dear Mr McAughtry,\n\nYour annual boiler service is now due. Our engineer has availability in your area next Tuesday (08:30–11:00) or Wednesday (09:00–12:00).\n\nPlease reply with your preferred slot and confirm whether parking is available on the driveway.\n\nKind regards,\nCotswold Heating Services',
        },
      ],
    },
    {
      id: 'demo-thread-3',
      messages: [
        {
          id: 'demo-msg-3',
          dateMs: hoursAgo(32),
          labels: ['INBOX'],
          headers: {
            From: 'Dr Martin Patel <m.patel@oakwooddental.co.uk>',
            To: `David McAughtry <${userEmail}>`,
            Subject: 'Follow-up regarding December check-up dates',
            'Message-ID': '<demo-3@oakwooddental.co.uk>',
          },
          snippet: 'Good afternoon David, we had to rearrange one of our afternoon clinics on 11 December. Would you like us to move your appointment to 12 December at 14:15?',
          bodyText:
            'Good afternoon David,\n\nWe have had to rearrange our afternoon clinic on Thursday 11 December. Would you like us to move your routine check-up to Friday 12 December at 14:15, or would a morning slot in the following week be more convenient?\n\nKind regards,\nDr Martin Patel',
        },
      ],
    },
    {
      id: 'demo-thread-4',
      messages: [
        {
          id: 'demo-msg-4',
          dateMs: hoursAgo(58),
          labels: ['INBOX'],
          headers: {
            From: 'Claire Henderson <claire@hendersonaccountancy.co.uk>',
            To: `David McAughtry <${userEmail}>`,
            Subject: 'Charity Gift Aid summary for 2025/26 return',
            'Message-ID': '<demo-4@hendersonaccountancy.co.uk>',
          },
          snippet: 'Hi David, I am pulling together the draft figures for your return. Do you have any additional Gift Aid donations from January to March that should be included?',
          bodyText:
            'Hi David,\n\nI am pulling together the draft figures for your self-assessment return. Could you let me know whether you made any additional Gift Aid donations between January and March that should be included before I finalise the schedule?\n\nThanks,\nClaire',
        },
      ],
    },

    // --- SHOULD BE EXCLUDED (Demonstrates Audit Transparency Log) ---
    {
      id: 'demo-excl-sent',
      messages: [
        {
          id: 'demo-excl-sent-1',
          dateMs: hoursAgo(26),
          labels: ['INBOX'],
          headers: {
            From: 'Tom Richards <tom@richardsjoinery.co.uk>',
            To: `David McAughtry <${userEmail}>`,
            Subject: 'Oak shelving quote',
          },
          bodyText: 'Hi David, attached is the quote for the oak shelving.',
        },
        {
          id: 'demo-excl-sent-2',
          dateMs: hoursAgo(20),
          labels: ['SENT'],
          headers: {
            From: `David McAughtry <${userEmail}>`,
            To: 'Tom Richards <tom@richardsjoinery.co.uk>',
            Subject: 'Re: Oak shelving quote',
          },
          bodyText: 'Thanks Tom, looks great — please go ahead.',
        },
      ],
    },
    {
      id: 'demo-excl-cc',
      messages: [
        {
          id: 'demo-excl-cc-1',
          dateMs: hoursAgo(11),
          labels: ['INBOX'],
          headers: {
            From: 'Helen Brooks <helen@villagehall.org.uk>',
            To: 'Committee Chair <chair@villagehall.org.uk>',
            Cc: `David McAughtry <${userEmail}>`,
            Subject: 'Minutes from Monday committee meeting',
          },
          bodyText: 'Hi all, copying the committee for visibility on Monday minutes.',
        },
      ],
    },
    {
      id: 'demo-excl-ebay',
      messages: [
        {
          id: 'demo-excl-ebay-1',
          dateMs: hoursAgo(9),
          labels: ['INBOX'],
          headers: {
            From: 'eBay <ebay@ebay.co.uk>',
            To: `David McAughtry <${userEmail}>`,
            Subject: 'Your eBay order has been dispatched',
          },
          bodyText: 'Good news! Your eBay item is on its way.',
        },
      ],
    },
    {
      id: 'demo-excl-receipt',
      messages: [
        {
          id: 'demo-excl-receipt-1',
          dateMs: hoursAgo(18),
          labels: ['INBOX'],
          headers: {
            From: 'Amazon.co.uk <auto-confirm@amazon.co.uk>',
            To: `David McAughtry <${userEmail}>`,
            Subject: 'Your Amazon.co.uk order confirmation #204-8821931',
          },
          bodyText: 'Thank you for your order. Your receipt and delivery estimate are below.',
        },
      ],
    },
    {
      id: 'demo-excl-alert',
      messages: [
        {
          id: 'demo-excl-alert-1',
          dateMs: hoursAgo(6),
          labels: ['INBOX'],
          headers: {
            From: 'Google Security <no-reply@accounts.google.com>',
            To: `David McAughtry <${userEmail}>`,
            Subject: 'Security alert: New sign-in on Windows',
            'Auto-Submitted': 'auto-generated',
          },
          bodyText: 'We noticed a new sign-in to your Google Account on a Windows device.',
        },
      ],
    },
    {
      id: 'demo-excl-newsletter',
      messages: [
        {
          id: 'demo-excl-newsletter-1',
          dateMs: hoursAgo(15),
          labels: ['INBOX', 'CATEGORY_PROMOTIONS'],
          headers: {
            From: 'The Weekend Gardener <newsletter@weekendgardener.co.uk>',
            To: `David McAughtry <${userEmail}>`,
            Subject: 'November pruning tips — Weekly Roundup',
            'List-Unsubscribe': '<https://weekendgardener.co.uk/unsubscribe>',
          },
          bodyText: 'Top stories this week. You are receiving this email because you subscribed. Unsubscribe from this list.',
        },
      ],
    },
  ];
}

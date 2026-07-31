import crypto from 'node:crypto';

export function uid() {
  return crypto.randomBytes(5).toString('hex').slice(0, 7);
}

export const OUTCOMES = ['Decided', 'Assigned', 'Deferred', 'Referred'];
export const BLOCK_TAGS = ['', 'Counsel', 'Decide', 'Coordinate'];

function pt(h, p, tag = '', carry = false, sens = false) {
  return { id: uid(), h, p, tag, carry, sens };
}

/* Default agenda for a new week — same shape and copy as the reference mockup. */
export function template(date) {
  return {
    v: 3,
    date,
    status: 'draft',
    roster: ['Bp. Bradshaw', 'Josh', 'Greg M.', 'Bro. Holmes', 'Ryan G.', 'Katrina M.', 'Diana G.', 'Sis. Welch', 'Lewis', 'Adam'],
    attendance: {},
    blocks: [
      {
        id: uid(), title: 'Open', dur: 10, tag: '', lead: '',
        points: [
          pt('Prayer', 'Assigned Sunday'),
          pt('Spiritual thought', 'Sis. Mang, on revelation'),
          pt('Handbook training', 'Bp. Bradshaw, 4.4 Effective Councils')
        ],
        held: '', notes: '', outcome: '', ph: "Training takeaway, next week's assignment..."
      },
      {
        id: uid(), title: 'Standing items', dur: 8, tag: 'Counsel',
        lead: 'Reviewed every week, at the top per Bp. Bradshaw.',
        points: [
          pt('Covenant path', 'Baptisms, confirmations, ordinations, and temple recommends coming up'),
          pt('Individuals to remember in prayers', ''),
          pt('Members without callings', '')
        ],
        held: '', notes: '', outcome: '', ph: 'Names and follow-ups...'
      },
      {
        id: uid(), title: 'Individuals and families', dur: 12, tag: 'Counsel',
        lead: 'RS and elders quorum presidents lead. Covenant path.',
        points: [
          pt('', 'New families and members - who reaches out'),
          pt('', 'Baptism Saturday - interview and program'),
          pt('', 'New-member lessons with the missionaries')
        ],
        held: 'Two visits held for bishopric - names not carried here',
        notes: '', outcome: '', ph: 'Decisions, who is going...'
      },
      {
        id: uid(), title: 'Organization needs', dur: 12, tag: 'Coordinate',
        lead: 'Needs and requests only. Nothing this week is a fine answer.',
        points: [
          pt('Primary', 'Counselor and worker vacancies; a family moving in October'),
          pt('Sunday School', 'New schedule starts September'),
          pt('Young Men and Young Women', 'Rudnick service project; Girls Camp in August'),
          pt('Elders Quorum, Relief Society, Mission leader, Seminary', 'Nothing this week')
        ],
        held: '', notes: '', outcome: '', ph: 'What the council agreed to...'
      },
      {
        id: uid(), title: 'Council items', dur: 12, tag: '', lead: '',
        points: [
          pt('Strength of Youth pamphlets', 'Josh - how to reach 75 active families', 'Decide'),
          pt('Priesthood / Relief Society meeting', 'Needs a yes or no today', 'Carried 19 Jul', true),
          pt('Annual youth activity costs', 'Girls Camp and high adventure', 'Decide'),
          pt('Ward activities', 'Summer, fall, Christmas - dates only', 'Coordinate')
        ],
        held: '', notes: '', outcome: '', ph: 'Outcome per item...'
      },
      {
        id: uid(), title: 'Standing checks', dur: 4, tag: '', lead: '',
        points: [
          pt('', 'Youth protection - review list'),
          pt('', 'Ward histories - submissions'),
          pt('', 'Key indicators')
        ],
        held: '', notes: '', outcome: '', ph: 'Flags only...'
      },
      {
        id: uid(), title: 'Close', dur: 2, tag: '', lead: 'Prayer: assigned Sunday',
        points: [], held: '', notes: '', outcome: '', ph: ''
      }
    ],
    assignments: [
      { id: uid(), t: 'Strength of Youth distribution', o: 'Josh', d: 'due 2 Aug' },
      { id: uid(), t: 'Ward council agenda', o: 'Josh', d: 'weekly' },
      { id: uid(), t: 'Single adult conference', o: 'Sis. Reed', d: 'due 9 Aug' }
    ],
    /* Derived from the shared absences calendar on read and at close. */
    away: [],
    calendar: [
      { id: uid(), n: 'Baptism', w: 'Sat 1 Aug' },
      { id: uid(), n: 'Girls Camp', w: 'August' },
      { id: uid(), n: 'New Sunday School schedule', w: 'September' }
    ]
  };
}

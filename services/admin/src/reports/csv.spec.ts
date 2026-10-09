import { csvFilename, toCsv } from './csv';

interface Row {
  name: string;
  value: number | null;
}

const columns = [
  { header: 'Name', value: (row: Row) => row.name },
  { header: 'Value', value: (row: Row) => row.value },
];

describe('toCsv', () => {
  it('writes a BOM so a spreadsheet reads UTF-8 correctly', () => {
    expect(toCsv<Row>([], columns).startsWith('\uFEFF')).toBe(true);
  });

  it('writes a header row and CRLF line endings', () => {
    const csv = toCsv<Row>([{ name: 'Desk lamp', value: 3 }], columns);
    expect(csv).toBe('\uFEFFName,Value\r\nDesk lamp,3\r\n');
  });

  it('renders a null cell as empty rather than the string null', () => {
    expect(toCsv<Row>([{ name: 'Cable', value: null }], columns)).toContain('Cable,\r\n');
  });

  it('quotes and escapes cells containing commas, quotes or newlines', () => {
    const csv = toCsv<Row>([{ name: 'Lamp, brass 12" tall\nsecond line', value: 1 }], columns);
    expect(csv).toContain('"Lamp, brass 12"" tall\nsecond line",1');
  });

  it('neutralises formula injection', () => {
    const rows: Row[] = [
      { name: '=1+1', value: 1 },
      { name: '+SUM(A1:A9)', value: 2 },
      { name: '-2+3', value: 3 },
      { name: '@import', value: 4 },
    ];
    const csv = toCsv(rows, columns);
    expect(csv).toContain("'=1+1,1");
    expect(csv).toContain("'+SUM(A1:A9),2");
    expect(csv).toContain("'-2+3,3");
    expect(csv).toContain("'@import,4");
  });

  it('leaves an ordinary value untouched', () => {
    expect(toCsv<Row>([{ name: 'Notebook', value: 12 }], columns)).toContain('Notebook,12');
  });
});

describe('csvFilename', () => {
  it('names the file after the report and its window', () => {
    expect(csvFilename('sales', '2026-07-01T00:00:00.000Z', '2026-07-31T23:59:59.000Z')).toBe(
      'sales-2026-07-01-to-2026-07-31.csv',
    );
  });
});

/**
 * Bundled sample dataset, text-identical to main branch sample_data.csv.
 * Imported via DataState.importCsvText(name, text) like pasted data.
 */
export class SampleData {
  static readonly NAME: string = 'MetricStudio Sample';

  static readonly CSV_TEXT: string =
    'date,category,value,region\n' +
    '2024-01-01,A,120,North\n' +
    '2024-02-01,A,150,North\n' +
    '2024-03-01,A,180,South\n' +
    '2024-01-01,B,90,South\n' +
    '2024-02-01,B,110,East\n' +
    '2024-03-01,B,130,East\n' +
    '2024-01-01,C,200,North\n' +
    '2024-02-01,C,170,West\n' +
    '2024-03-01,C,160,West\n';
}

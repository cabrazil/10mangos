import * as xlsx from 'xlsx';

export interface ItauCardTransaction {
  date: Date;
  rawDate: string;
  description: string;
  originalDescription: string;
  amount: number; // Positivo para compra, negativo para pagamento
  isPayment: boolean;
  installmentNumber?: number;
  installmentCount?: number;
  holderName?: string;
  titularidade?: string;
  cardType?: string;
  cardNumber?: string;
  notes?: string;
}

export interface ItauCardStatementResult {
  isItauCard: boolean;
  faturaTitle?: string;
  cardName?: string;
  invoiceTotal?: number;
  dueDate?: string;
  transactions: ItauCardTransaction[];
}

export function parseItauCardStatement(sheetOrBuffer: Buffer | string): ItauCardStatementResult {
  const workbook = typeof sheetOrBuffer === 'string'
    ? xlsx.read(sheetOrBuffer, { type: 'string', cellDates: true })
    : xlsx.read(sheetOrBuffer, { type: 'buffer', cellDates: true });

  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const rows: any[][] = xlsx.utils.sheet_to_json(worksheet, { header: 1 });

  let headerIndex = -1;
  let colDate = -1;
  let colDesc = -1;
  let colInstallment = -1;
  let colAmount = -1;
  let colTitularidade = -1;
  let colNome = -1;
  let colCardType = -1;
  let colCardNumber = -1;

  let faturaTitle = '';
  let cardName = '';
  let invoiceTotal = 0;
  let dueDate = '';

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !Array.isArray(row)) continue;

    const rowStr = row.map((c) => String(c || '').trim()).join(' ');

    if (/fatura (fechada|aberta)/i.test(rowStr)) {
      faturaTitle = rowStr;
    }

    if (/vencimento/i.test(rowStr) && i + 1 < rows.length) {
      const nextRow = rows[i + 1];
      if (nextRow) {
        const foundCard = nextRow.find((c) => /black|mastercard|visa|final/i.test(String(c)));
        if (foundCard) cardName = String(foundCard);
      }
    }

    // Verificar se é a linha de cabeçalho
    const hasDate = row.some((c) => /^data$/i.test(String(c || '').trim()));
    const hasDesc = row.some((c) => /^lan[çc]amento$/i.test(String(c || '').trim()));
    const hasAmount = row.some((c) => /^valor$/i.test(String(c || '').trim()));

    if (hasDate && hasDesc && hasAmount) {
      headerIndex = i;
      row.forEach((cell, idx) => {
        const val = String(cell || '').toLowerCase().trim();
        if (val === 'data') colDate = idx;
        else if (val.includes('lançamento') || val.includes('lancamento')) colDesc = idx;
        else if (val.includes('parcelamento')) colInstallment = idx;
        else if (val === 'valor') colAmount = idx;
        else if (val.includes('titularidade')) colTitularidade = idx;
        else if (val === 'nome') colNome = idx;
        else if (val.includes('tipo')) colCardType = idx;
        else if (val.includes('número') || val.includes('numero')) colCardNumber = idx;
      });
      break;
    }
  }

  if (headerIndex === -1 || colDate === -1 || colDesc === -1 || colAmount === -1) {
    return { isItauCard: false, transactions: [] };
  }

  const transactions: ItauCardTransaction[] = [];

  for (let i = headerIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !Array.isArray(row) || row.length === 0) continue;

    const rawDate = row[colDate];
    const rawDesc = row[colDesc];
    const rawAmount = row[colAmount];

    if (!rawDate && !rawDesc && !rawAmount) continue;

    const firstNonEmpty = String(
      row.find((c) => c !== undefined && c !== null && String(c).trim() !== '') || ''
    ).toLowerCase();

    if (firstNonEmpty.includes('subtotal') || firstNonEmpty.includes('importante saber')) {
      break;
    }

    const descStr = String(rawDesc || '').trim();
    if (!descStr) continue;

    // Tratar Valor
    let amount = 0;
    if (typeof rawAmount === 'number') {
      amount = rawAmount;
    } else {
      const cleaned = String(rawAmount || '0')
        .replace(/[R$\s]/g, '')
        .replace(/\./g, '')
        .replace(',', '.');
      amount = parseFloat(cleaned);
    }
    if (isNaN(amount)) continue;

    // Tratar Data de forma robusta e sem desvio de fuso
    let dateObj: Date;
    let rawDateStr = '';

    if (rawDate instanceof Date) {
      dateObj = rawDate;
      rawDateStr = rawDate.toISOString().split('T')[0];
    } else if (typeof rawDate === 'number') {
      dateObj = new Date(Math.round((rawDate - 25569) * 86400 * 1000));
      rawDateStr = dateObj.toISOString().split('T')[0];
    } else {
      rawDateStr = String(rawDate || '').trim();
      if (rawDateStr.includes('-')) {
        const [y, m, d] = rawDateStr.split('T')[0].split('-').map(Number);
        dateObj = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
      } else if (rawDateStr.includes('/')) {
        const [d, m, y] = rawDateStr.split('/').map(Number);
        dateObj = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
      } else {
        dateObj = new Date(rawDateStr);
      }
    }

    if (isNaN(dateObj.getTime())) {
      dateObj = new Date();
    }

    const installmentStr = colInstallment !== -1 ? String(row[colInstallment] || '').trim() : '';
    const titularidade = colTitularidade !== -1 ? String(row[colTitularidade] || '').trim() : '';
    const nome = colNome !== -1 ? String(row[colNome] || '').trim() : '';
    const cardType = colCardType !== -1 ? String(row[colCardType] || '').trim() : '';
    const cardNumber = colCardNumber !== -1 ? String(row[colCardNumber] || '').trim() : '';

    let installmentNumber: number | undefined = undefined;
    let installmentCount: number | undefined = undefined;
    if (installmentStr) {
      const match = installmentStr.match(/(\d+)\s*de\s*(\d+)/i);
      if (match) {
        installmentNumber = parseInt(match[1]);
        installmentCount = parseInt(match[2]);
      }
    }

    const noteParts: string[] = [];
    if (nome) noteParts.push(nome);
    if (titularidade) noteParts.push(`(${titularidade})`);
    if (cardType) noteParts.push(`[${cardType}]`);
    if (cardNumber) noteParts.push(cardNumber);

    const isPayment =
      descStr.toLowerCase().includes('pagamento boleto') ||
      descStr.toLowerCase().includes('pagamento de fatura') ||
      descStr.toLowerCase().includes('pagto boleto') ||
      descStr.toLowerCase().includes('pgto fatura');

    transactions.push({
      date: dateObj,
      rawDate: rawDateStr,
      description: installmentCount ? `${descStr} (${installmentNumber}/${installmentCount})` : descStr,
      originalDescription: descStr,
      amount,
      isPayment,
      installmentNumber,
      installmentCount,
      notes: noteParts.length > 0 ? noteParts.join(' ') : undefined,
      holderName: nome || undefined,
      titularidade: titularidade || undefined,
      cardType: cardType || undefined,
      cardNumber: cardNumber || undefined,
    });
  }

  return {
    isItauCard: true,
    faturaTitle,
    cardName,
    invoiceTotal,
    dueDate,
    transactions,
  };
}

export interface OfxTransaction {
  fitId: string;
  type: string;
  date: Date;
  amount: number; // decimal com sinal (negativo para débito, positivo para crédito)
  memo: string;
  checkNumber?: string;
  payeeName?: string;
}

export interface OfxData {
  bankId?: string;
  accountId?: string;
  currency?: string;
  ledgerBalance?: number;
  balanceDate?: Date;
  periodStart?: Date;
  periodEnd?: Date;
  transactions: OfxTransaction[];
}

export function parseOfxString(ofxContent: string): OfxData {
  // Limpar quebras de linha e cabeçalhos SGML
  const tagValue = (tag: string, text: string): string | undefined => {
    const regex = new RegExp(`<${tag}>([^<\\r\\n]+)`, 'i');
    const match = text.match(regex);
    return match ? match[1].trim() : undefined;
  };

  const parseOfxDate = (dateStr?: string): Date | undefined => {
    if (!dateStr) return undefined;
    // Formatos comuns: YYYYMMDDHHMMSS ou YYYYMMDD ou com fuso [-3:BRT] / [-03:EST]
    const clean = dateStr.replace(/\[.*\]/, '').trim();
    if (clean.includes('-') || clean.includes('/')) {
      const d = new Date(clean);
      if (!isNaN(d.getTime())) return d;
    }
    if (clean.length >= 8) {
      const year = parseInt(clean.substring(0, 4), 10);
      const month = parseInt(clean.substring(4, 6), 10) - 1;
      const day = parseInt(clean.substring(6, 8), 10);
      if (!isNaN(year) && !isNaN(month) && !isNaN(day)) {
        return new Date(Date.UTC(year, month, day, 12, 0, 0));
      }
    }
    return undefined;
  };

  const bankId = tagValue('BANKID', ofxContent);
  const accountId = tagValue('ACCTID', ofxContent);
  const currency = tagValue('CURDEF', ofxContent);

  const balAmtStr = tagValue('BALAMT', ofxContent);
  const ledgerBalance = balAmtStr ? parseFloat(balAmtStr.replace('+', '').replace(',', '.')) : undefined;
  const balanceDate = parseOfxDate(tagValue('DTASOF', ofxContent));

  const dtStart = parseOfxDate(tagValue('DTSTART', ofxContent));
  const dtEnd = parseOfxDate(tagValue('DTEND', ofxContent));

  // Extrair blocos <STMTTRN>...</STMTTRN> (ou sem fechamento)
  const transactions: OfxTransaction[] = [];
  const stmtRegex = /<STMTTRN>([\s\S]*?)(?:<\/STMTTRN>|(?=<STMTTRN>|<\/BANKTRANLIST>|<\/CCSTMTRS>|<\/OFX>|$))/gi;
  let match;

  while ((match = stmtRegex.exec(ofxContent)) !== null) {
    const block = match[1];
    const fitId = tagValue('FITID', block) || `trn-${Date.now()}-${Math.random()}`;
    const type = tagValue('TRNTYPE', block) || 'OTHER';
    const dtPostedStr = tagValue('DTPOSTED', block);
    const trnAmtStr = tagValue('TRNAMT', block) || '0';
    const memoTag = tagValue('MEMO', block);
    const nameTag = tagValue('NAME', block);
    const checkNumber = tagValue('CHECKNUM', block);

    let memo = memoTag || nameTag || 'Lançamento sem descrição';
    if (memoTag && nameTag && memoTag !== nameTag) {
      memo = `${nameTag} - ${memoTag}`;
    }

    const amount = parseFloat(trnAmtStr.replace('+', '').replace(',', '.'));
    const date = parseOfxDate(dtPostedStr) || new Date();

    transactions.push({
      fitId,
      type,
      date,
      amount,
      memo,
      payeeName: nameTag,
      checkNumber,
    });
  }

  return {
    bankId,
    accountId,
    currency,
    ledgerBalance,
    balanceDate,
    periodStart: dtStart,
    periodEnd: dtEnd,
    transactions,
  };
}

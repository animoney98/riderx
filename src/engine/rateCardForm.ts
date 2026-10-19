import { validateRateCard, type RateCard } from './payout';

/** Rupee text such as "50", "2,500" or "12.5" -> integer paise. Throws on anything else. */
export function rupeesToPaise(text: string, label: string): number {
  const t = text.replace(/[,\s₹]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(t)) throw new Error(`${label} must be an amount in rupees, like 50 or 12.50`);
  const [r, p = ''] = t.split('.');
  return Number(r) * 100 + Number(p.padEnd(2, '0'));
}

/** Kilometres text such as "6" or "6.5" -> hundredths of a km. */
export function kmToKm100(text: string, label: string): number {
  const t = text.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(t)) throw new Error(`${label} must be a number of km, like 6 or 6.5`);
  const [k, f = ''] = t.split('.');
  return Number(k) * 100 + Number(f.padEnd(2, '0'));
}

export interface RateCardInput {
  name: string;
  version: number;
  firstSlabOrders: string;
  firstSlabRate: string;
  laterRate: string;
  includedKm: string;
  extraKmRate: string;
  batchBonus: string;
  rainPerOrder: string;
  /** Optional. One amount for a raining batched trip; blank = rain bonus per order times its orders. */
  rainBatchedTrip?: string;
  festivalPerOrder: string;
  batchedTripBaseOrders: number;
}

export function buildRateCard(i: RateCardInput): RateCard {
  const limit = Number(i.firstSlabOrders);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('Orders at the first rate must be a whole number between 1 and 500');
  const card: RateCard = {
    name: i.name,
    version: i.version,
    slabs: [{ upToOrder: limit, ratePaise: rupeesToPaise(i.firstSlabRate, 'First rate') }, { upToOrder: null, ratePaise: rupeesToPaise(i.laterRate, 'Rate after that') }],
    includedKm100: kmToKm100(i.includedKm, 'Included distance'),
    extraKmRatePaise: rupeesToPaise(i.extraKmRate, 'Extra km rate'),
    batchBonusPaise: rupeesToPaise(i.batchBonus, 'Batch bonus'),
    rainBonusPaisePerOrder: rupeesToPaise(i.rainPerOrder, 'Rain bonus'),
    ...(i.rainBatchedTrip?.trim() ? { rainBonusBatchedTripPaise: rupeesToPaise(i.rainBatchedTrip, 'Rain bonus for a batched trip') } : {}),
    festivalBonusPaisePerOrder: rupeesToPaise(i.festivalPerOrder, 'Festival bonus'),
    batchedTripBaseOrders: i.batchedTripBaseOrders,
  };
  validateRateCard(card);
  return card;
}

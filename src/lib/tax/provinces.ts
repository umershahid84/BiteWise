// Canadian provinces and territories, with the sales tax on restaurant meals (prepared food) in basis points.
// Canada has no city or county sales taxes, so the province sets the whole rate:
//   GST 5% everywhere; HST (federal + provincial in one) in ON, NB, NL, NS and PE; plus provincial PST/RST/QST where
//   it applies to restaurant meals (BC exempts prepared food from PST; MB, SK and QC tax it). Rates as of 2026.
// Ontario exempts the provincial part (8%) on prepared food of $4.00 or less. Verify with an accountant before launch.

export type Province = { code: string; name: string; mealsRateBps: number; taxLabel: string; adultAge: number };

export const CA_PROVINCES: Province[] = [
  { code: 'AB', name: 'Alberta', mealsRateBps: 500, taxLabel: 'GST 5%', adultAge: 18 },
  { code: 'BC', name: 'British Columbia', mealsRateBps: 500, taxLabel: 'GST 5%', adultAge: 19 },
  { code: 'MB', name: 'Manitoba', mealsRateBps: 1200, taxLabel: 'GST 5% + RST 7%', adultAge: 18 },
  { code: 'NB', name: 'New Brunswick', mealsRateBps: 1500, taxLabel: 'HST 15%', adultAge: 19 },
  { code: 'NL', name: 'Newfoundland and Labrador', mealsRateBps: 1500, taxLabel: 'HST 15%', adultAge: 19 },
  { code: 'NS', name: 'Nova Scotia', mealsRateBps: 1400, taxLabel: 'HST 14%', adultAge: 19 },
  { code: 'NT', name: 'Northwest Territories', mealsRateBps: 500, taxLabel: 'GST 5%', adultAge: 19 },
  { code: 'NU', name: 'Nunavut', mealsRateBps: 500, taxLabel: 'GST 5%', adultAge: 19 },
  { code: 'ON', name: 'Ontario', mealsRateBps: 1300, taxLabel: 'HST 13%', adultAge: 18 },
  { code: 'PE', name: 'Prince Edward Island', mealsRateBps: 1500, taxLabel: 'HST 15%', adultAge: 18 },
  { code: 'QC', name: 'Quebec', mealsRateBps: 1498, taxLabel: 'GST 5% + QST 9.975%', adultAge: 18 },
  { code: 'SK', name: 'Saskatchewan', mealsRateBps: 1100, taxLabel: 'GST 5% + PST 6%', adultAge: 18 },
  { code: 'YT', name: 'Yukon', mealsRateBps: 500, taxLabel: 'GST 5%', adultAge: 19 },
];

export const PROVINCE_CODES = CA_PROVINCES.map((p) => p.code);
export const provinceByCode = (code: string) => CA_PROVINCES.find((p) => p.code === code.toUpperCase());

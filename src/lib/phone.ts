// US phone numbers, shown and stored as (xxx) xxx-xxxx.

// The digits of a number, without a leading country code 1.
export function phoneDigits(input: string) {
  const d = input.replace(/\D/g, '');
  return (d.length > 10 && d.startsWith('1') ? d.slice(1) : d).slice(0, 10);
}

// Formats as the number is typed: "2065" -> "(206) 5", "2065550123" -> "(206) 555-0123".
export function formatPhoneInput(input: string) {
  const d = phoneDigits(input);
  if (!d) return '';
  if (d.length <= 3) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

// A complete number as (xxx) xxx-xxxx; anything else is shown as it was entered.
export function displayPhone(phone: string | null | undefined) {
  if (!phone) return '';
  const d = phoneDigits(phone);
  return d.length === 10 ? formatPhoneInput(d) : phone;
}

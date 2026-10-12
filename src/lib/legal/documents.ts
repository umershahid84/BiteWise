// Bite Wise legal documents. Each document has a version; users must accept the current version of
// every document required for their role before their account is created, and again whenever a
// version changes. When you edit the text, change LEGAL_VERSION and EFFECTIVE here AND the versions
// in the legal_documents table (add a migration); a test checks that they match.
//
// Company details come from LEGAL_ENTITY_NAME, SUPPORT_EMAIL and LEGAL_ADDRESS.
//
// There is one set for the United States and one for Canada (the "-ca" documents): people accept the set for the
// country they sign up in (a customer's home, a restaurant's address). The text is shared, with the parts that differ
// written for each country. Have a US attorney and a Canadian lawyer review them before launch; Quebec also requires
// French versions of consumer and standard-form contracts.

import type { Role } from '@/lib/constants';
import type { Country } from '@/lib/regions';
import { describeServiceFee, type ServiceFee } from '@/lib/service-fee';

export const LEGAL_VERSION = '2026-10-21.1';
export const EFFECTIVE = 'October 18, 2026';

export type Company = {
  entity: string; email: string; address: string; serviceFee: ServiceFee; graceMinutes: number;
  // Restaurant subscription: prices in dollars, and how many Pioneer Member (free) spots there are.
  monthlyPrice: number; annualPrice: number; foundingSpots: number;
};

// The customer service fee as set in Settings: "5% of the food subtotal" or "$0.99 per order" (CA$ in Canada).
const feeText = (c: Company, j: Jur) => describeServiceFee(c.serviceFee, j.ca ? 'cad' : 'usd');

const usd = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;

// Which country's version is being rendered, and the links between that set's documents.
type Jur = { ca: boolean; privacy: string; customerTerms: string };
const US: Jur = { ca: false, privacy: '/legal/privacy', customerTerms: '/legal/customer-terms' };
const CA: Jur = { ca: true, privacy: '/legal/privacy-ca', customerTerms: '/legal/customer-terms-ca' };
// The US text, or the Canadian text.
const t = (j: Jur, us: string, ca: string) => (j.ca ? ca : us);

const ALLERGENS_US = 'milk, eggs, fish, crustacean shellfish, tree nuts, peanuts, wheat, soybeans and sesame';
const ALLERGENS_CA = 'peanuts, tree nuts, sesame, milk, eggs, fish, crustaceans and molluscs, soy, wheat and triticale, mustard, and sulphites';

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] as string);

function customerTerms(c: Company, j: Jur) {
  return `
<p class="lead">Welcome to Bite Wise. These Customer Terms of Service (the "<b>Terms</b>") are a binding agreement between you and ${c.entity}
("<b>Bite Wise</b>," "<b>we</b>," "<b>us</b>") and govern your use of the Bite Wise website and services (the "<b>Service</b>") to find and buy
discounted surplus food from participating restaurants. By selecting <b>Accept</b> when you create an account, or by using the Service,
you agree to these Terms and to our <a href="${j.privacy}">Privacy Policy</a>. If you do not agree, select <b>Decline</b> and do not use the Service.</p>
${t(j, `<p>These are the Terms for customers in the <b>United States</b>. Customers in Canada agree to the Canadian Terms.</p>`,
  `<p>These are the Terms for customers in <b>Canada</b>. Customers in the United States agree to the US Terms.</p>`)}

<h2>1. Who we are and what we do</h2>
<p>1.1 <b>Marketplace only.</b> Bite Wise operates an online marketplace that connects customers with independent restaurants, cafés,
bakeries and other food businesses ("<b>Restaurants</b>") that sell surplus food. Bite Wise does not prepare, cook, store, package,
handle, inspect or sell food. Each purchase is a sale made by the Restaurant to you. Bite Wise facilitates the order and payment.</p>
<p>1.2 <b>Surplus food.</b> Food offered on Bite Wise ("<b>Offers</b>") is food a Restaurant has already prepared and would otherwise
discard. For example, it may be a mistaken order, an order that was delayed or never collected, or end-of-day or excess production.
You understand that surplus food:</p>
<ul>
  <li>may have been prepared some time before you buy it, and should be picked up promptly and eaten or refrigerated soon after pickup;</li>
  <li>may differ from the Restaurant's regular menu item in portion, packaging, preparation or ingredients (for example, a "wrong order" item may contain ingredients a previous customer asked for); and</li>
  <li>is sold in the condition described by the Restaurant, in limited quantities, while its discard timer is running.</li>
</ul>

<h2>2. Eligibility and your account</h2>
<p>2.1 ${t(j,
  `You must be at least 18 years old (or the age of majority where you live, if it is higher) and able to form a binding contract to
create an account. The Service is available in the United States, in the areas where participating Restaurants operate.`,
  `You must have reached the age of majority in your province or territory (18 or 19) and be able to form a binding contract to create
an account. The Service is available in Canada, in the areas where participating Restaurants operate.`)}</p>
<p>2.2 You agree to give accurate information (including a valid email address), to keep your password confidential, and to be
responsible for all activity on your account. Tell us immediately at <a href="mailto:${c.email}">${c.email}</a> if you believe your account
has been used without your permission. You may have only one customer account.</p>

<h2>3. Allergens, dietary information and food safety</h2>
<p>3.1 <b>Restaurants supply all food information.</b> Item names, descriptions, photos, ingredients and dietary tags (such as
"vegan" or "gluten-free") are provided by the Restaurant. Bite Wise does not verify them and does not guarantee that food is free of any
allergen.</p>
<p>3.2 <b>If you have a food allergy or dietary restriction, ask the Restaurant before you eat.</b> Surplus food may have been
prepared in kitchens that handle common allergens, including ${t(j, ALLERGENS_US, ALLERGENS_CA)},
and "wrong order" items may contain ingredients that differ from the regular menu. Do not buy or eat an item if you are unsure it is
safe for you.</p>
<p>3.3 <b>Inspect food before you accept it.</b> Check your order at the counter when you pick it up. If it appears unsafe, spoiled or
not as described, do not accept or eat it, and tell the Restaurant and us at <a href="mailto:${c.email}">${c.email}</a>. Once you accept
your order, it is yours as is (Section 6).</p>
<p>3.4 Each Restaurant is responsible for complying with food safety laws, including ${t(j,
  'the food code and health department rules of the state and locality where it operates',
  'the food safety and food premises laws of its province or territory, local public health rules and, where they apply, the Safe Food for Canadians Act and Regulations')}.</p>

<h2>4. Ordering, pricing and payment</h2>
<p>4.1 <b>Prices.</b> Before you place an order, we show you the item's original price, the Restaurant's discount, the discounted
price, a Bite Wise service fee (currently ${feeText(c, j)}), applicable sales tax, and the total. Sales tax on the food is at the
Restaurant's local rate; ${t(j, 'sales tax on the service fee is at the Washington rate for Bite Wise\'s location', 'HST on the service fee is at the Newfoundland and Labrador rate for Bite Wise\'s location')}.
Orders are charged in the currency of the Restaurant's country: U.S. dollars at Restaurants in the United States and Canadian
dollars at Restaurants in Canada. If your card is in another currency, your card issuer may charge its own conversion fees.</p>
<p>4.2 <b>Payment authorization.</b> When you place an order, we (through our payment processor) place a temporary authorization hold
on your debit or credit card for the order total. <b>Your card is charged only when the Restaurant confirms pickup by entering your
PIN.</b> If you cancel an order or do not pick it up, the hold is released except for the service fee, which is charged as described
in Section 4.6. Your card issuer controls how long it takes for a released hold to disappear from your statement.</p>
<p>4.3 <b>Saved cards.</b> If you choose to save a card, you authorize us and our payment processor to store it securely and to use
it for future orders you place. Card numbers are handled by our payment processor. Bite Wise stores only the card brand, last four
digits and expiry date. You can remove a saved card at any time on your Account page.</p>
<p>4.4 <b>Order confirmation.</b> An order is confirmed when you receive a 4-digit pickup PIN. The Restaurant may decline or cancel an
order it cannot fulfil (for example, if food is found to be unsuitable), in which case you will not be charged.</p>
<p>4.5 <b>Taxes.</b> ${t(j,
  `Because you pick your order up at the Restaurant, sales tax is charged at the rate that applies at the Restaurant's address (state,
county, city and any local taxes), which we calculate automatically. The sales tax on your food is passed to the Restaurant, which reports
and remits it, except where Bite Wise is required to collect and remit it as a marketplace facilitator. Any sales tax on the Bite Wise
service fee is remitted by Bite Wise.`,
  `Because you pick your order up at the Restaurant, sales taxes are charged for the province or territory where the Restaurant is: the
GST or HST, and any provincial sales tax on restaurant meals (PST, RST or QST), which we calculate automatically. The tax on your food is
passed to the Restaurant, which reports and remits it, except where Bite Wise is required to collect and remit it as a platform operator
under the Excise Tax Act or provincial law. Any tax on the Bite Wise service fee is remitted by Bite Wise.`)}</p>
<p>4.6 <b>The service fee is not refundable.</b> The Bite Wise service fee pays for reserving the food for you and processing your
order, and <b>it is not refunded, whether or not you pick up your order</b>. In particular:</p>
<ul>
  <li>if you <b>cancel</b> an order, or <b>do not pick it up</b> before the discard timer ends (a missed pickup, Section 5.4), you are charged
  the service fee (and any sales tax on it), and the rest of the hold is released; if you paid part of the order with Platform Credit, the
  service fee is charged to your card first and then taken from that credit;</li>
  <li>completed orders are not refunded at all (Section 6).</li>
</ul>
<p>The only exception is an order the Restaurant or Bite Wise cancels or declines (for example, because the food became unavailable or
unsafe, or the Restaurant's account was closed), or an order whose payment failed: those holds are released in full and you are not
charged at all.</p>
<p>4.7 <b>Coupons.</b> From time to time Bite Wise may send you coupon codes. A coupon may waive the service fee, or take a fixed amount
or a percentage off the price of the food, as the coupon says. Enter the code at checkout; the discount is shown before you place your
order. One coupon can be used per order, and each coupon once per customer. Coupons work only at Restaurants in the country they were
issued for, only until their expiration date, and only while Bite Wise has not withdrawn them. They have no cash value, cannot be sold,
transferred or exchanged for Platform Credit, and are void where prohibited. If an order is cancelled before pickup, or its payment fails,
you can use the coupon again; a missed pickup uses it up. Sales tax is charged on the price after the coupon. We may refuse or reverse a
coupon used by mistake, against these Terms or fraudulently.</p>

<h2>5. Pickup, PIN and the discard timer</h2>
<p>5.1 Each Offer has a discard timer set by the Restaurant. You must pick up your order at the Restaurant before the timer ends. If
you do not, the Restaurant may discard the food, your order will be released ${c.graceMinutes} minutes after the timer ends, and you will
be charged only the non-refundable service fee (Section 4.6).</p>
<p>5.2 Your PIN is how the Restaurant confirms that you are the buyer. <b>Keep it private.</b> Anyone who presents your PIN may
receive your order, and your card will be charged when the Restaurant enters it. Bite Wise is not responsible for orders collected by
someone using a PIN you shared.</p>
<p>5.3 You may cancel an order from the My Orders page at any time before it is picked up. The food goes back on sale and the hold on
your card is released, except for the non-refundable service fee (Section 4.6).</p>
<p>5.4 <b>Missed pickups.</b> An order that you do not pick up and do not cancel before the discard timer ends is a <b>missed pickup</b>: the
food was held for you, could not be sold to anyone else, and is usually thrown away. To prevent food waste, Bite Wise counts missed pickups
automatically, and the following steps are taken automatically by the platform, without further notice:</p>
<ul>
  <li><b>Three missed pickups in a row:</b> your account is <b>suspended for 30 days</b>. While it is suspended you cannot log in or place
  orders, and any open orders are cancelled without charge. When the 30 days are over, your account is <b>reactivated automatically</b>.</li>
  <li><b>After a suspension:</b> the <b>first missed pickup</b> after your account is reactivated results in the <b>permanent closure (ban)</b>
  of your account, as described in Section 12.</li>
  <li>Picking up an order resets the count of missed pickups in a row. Orders you cancel before the timer ends, and orders the Restaurant
  cancels or declines, are not missed pickups.</li>
  <li>We email you after each missed pickup, and when your account is suspended or closed. Bite Wise administrators are notified as well
  and may review or reverse a suspension or ban. If you believe a missed pickup was recorded in error, contact us at
  <a href="mailto:${c.email}">${c.email}</a>.</li>
</ul>

<h2>6. All sales are final: food is sold as is</h2>
<p>6.1 <b>Sold as is.</b> Surplus food is food a Restaurant has already prepared and would otherwise throw away. It is sold at a discount,
<b>as is</b>, in the condition it is in when you pick it up, with no warranty of any kind from the Restaurant or Bite Wise beyond what the
law requires.</p>
<p>6.2 <b>No right to a refund.</b> <b>All sales are final.</b> Once you have picked up an order (the Restaurant has entered your PIN),
<b>you are not entitled to a refund</b> from the Restaurant or from Bite Wise, in whole or in part. This includes matters of taste,
portion, temperature, packaging or preparation, and food that differs from the Restaurant's regular menu. Surplus food can't be resold
once it has left the Restaurant, so this rule keeps food from being bought and returned and going to waste. The service fee is never
refunded (Section 4.6).</p>
<p><b>Courtesy refunds.</b> Bite Wise may, on a case-by-case basis and at its sole discretion, give a refund as a courtesy or for your
loyalty, either to your original form of payment or as Bite Wise Platform Credit (Section 6.6). A courtesy refund is a goodwill gesture,
not a right: Bite Wise has no obligation to give one, and giving one does not mean it will be given again. Card refunds usually appear
within 5 to 10 business days, depending on your card issuer.</p>
<p>6.3 <b>Before you accept it.</b> Because there are no refunds, please check your order at the counter (Section 3.3). If it is not the
food you ordered, or it appears unsafe or spoiled, do not accept it: the Restaurant can cancel the order through Bite Wise support, and
then you are not charged (Section 4.6).</p>
<p>6.4 <b>Report safety problems.</b> If you believe food made you ill or was unsafe, contact your local health department and tell us at
<a href="mailto:${c.email}">${c.email}</a>, so we can review the Restaurant.</p>
<p>6.5 <b>Your legal rights.</b> Nothing in these Terms limits any right you have under ${t(j,
  'the consumer protection laws of your state',
  'the consumer protection legislation of your province or territory (for example, Ontario\'s Consumer Protection Act, 2002, or Quebec\'s Consumer Protection Act)')}
or other laws that cannot be waived. Where such a law requires a refund, it will be given as the law requires.</p>
<p>6.6 <b>Bite Wise Platform Credit.</b> Platform Credit is a promotional and courtesy balance issued by Bite Wise, at its discretion,
to your account.</p>
<ul>
  <li><b>Where you see it:</b> your balance appears in the site header, on your Account page (with a history of every credit and use),
  and at checkout.</li>
  <li><b>Using it:</b> you choose whether to use it and how much, up to your balance and the order total. Any remainder is charged to
  your card, and the card portion must be at least $0.50.</li>
  <li><b>Unused orders:</b> credit applied to an order that is cancelled, declined or not picked up is returned to your balance, less any
  part of the non-refundable service fee it paid (Section 4.6).</li>
  <li><b>Currency:</b> Platform Credit is in the currency of your country of residence (U.S. dollars in the United States, Canadian
  dollars in Canada) and can be used only at Restaurants in that country.</li>
  <li><b>Restrictions:</b> Platform Credit has no cash value, cannot be purchased, reloaded, sold or transferred, and cannot be redeemed
  for cash except where required by law.</li>
  <li><b>Expiry:</b> it does not expire while your account is open and in good standing. If we close your account for fraud or a serious
  breach of these Terms, unused credit is forfeited to the extent permitted by law.</li>
  <li><b>Errors:</b> we may correct credit issued in error.</li>
  <li><b>Who pays:</b> Platform Credit is funded by Bite Wise; when you use it, the Restaurant is paid in full for your order.</li>
</ul>

<h2>7. Acceptable use</h2>
<p>You agree not to: (a) use the Service for anything unlawful, fraudulent or harmful; (b) resell food bought through Bite Wise;
(c) place orders you do not intend to pick up (see Section 5.4), or repeatedly abuse cancellations or holds; (d) harass, threaten or abuse Restaurant
staff or other users; (e) try to guess PINs, access other accounts, or interfere with the security or operation of the Service;
(f) scrape, copy or reverse-engineer the Service except as allowed by law; or (g) use someone else's payment card without permission.
We may suspend or close accounts that break these rules.</p>

<h2>8. Intellectual property</h2>
<p>The Service, including the Bite Wise name, logo, design and software, is owned by Bite Wise or its licensors and protected by law.
We grant you a limited, personal, non-transferable, revocable licence to use the Service for its intended purpose. Restaurant names,
menus and photos belong to the Restaurants.</p>

<h2>9. Disclaimers</h2>
<p>To the fullest extent permitted by law, the Service is provided "as is" and "as available." Bite Wise does not make any warranty
about food sold by Restaurants, including its quality, safety, ingredients, allergens, fitness for a particular purpose or
conformity to its description, which are the Restaurant's responsibility. We do not guarantee that the Service will be uninterrupted,
error-free, or that any particular Offer will be available.</p>

<h2>10. Limitation of liability</h2>
<p>10.1 To the fullest extent permitted by law, Bite Wise and its officers, employees and agents will not be liable for any indirect,
incidental, special, consequential or punitive damages, or for lost profits or data, arising out of or related to your use of the
Service or food purchased through it.</p>
<p>10.2 To the fullest extent permitted by law, Bite Wise's total liability for any claim arising out of or relating to these Terms or
the Service is limited to the greater of (a) the amounts you paid through the Service in the 6 months before the claim arose, or
(b) $100.</p>
<p>10.3 Nothing in these Terms excludes or limits liability that cannot be excluded or limited under applicable law, including
liability for gross negligence, wilful misconduct, or death or personal injury caused by Bite Wise's negligence.</p>

<h2>11. Indemnity</h2>
<p>${t(j, '', 'To the extent permitted by the consumer protection laws of your province or territory, ')}You agree to indemnify and hold
Bite Wise harmless from claims, losses and expenses (including reasonable ${t(j, "attorneys' fees", 'legal fees')}) arising from your misuse
of the Service or your violation of these Terms or the law.</p>

<h2>12. Suspension and termination</h2>
<p>You may close your account at any time by contacting us. We may suspend your access for a set number of days, or terminate it
permanently (a ban), if you violate these Terms, if required by law, or to protect users, Restaurants or the Service. Missed pickups lead
to an automatic suspension and then an automatic ban as described in Section 5.4. A banned
person may not open a new account, and any open orders are cancelled without charge. Sections that by their nature should survive termination
(including Sections 3, 6, 9, 10, 11 and 14) will survive.</p>

<h2>13. Changes to these Terms</h2>
<p>We may update these Terms from time to time. If we make changes, we will post the new version with a new effective date and ask
you to review and accept it before you continue using the Service. If you do not accept the updated Terms, you may close your account.</p>

<h2>14. Governing law and disputes</h2>
<p>14.1 ${t(j,
  'These Terms are governed by the laws of the state in which you live and by applicable United States federal law.',
  'These Terms are governed by the laws of the province or territory in which you live and the federal laws of Canada that apply there.')}</p>
<p>14.2 Before filing a claim, you agree to contact us at <a href="mailto:${c.email}">${c.email}</a> and try to resolve the dispute
informally for at least 30 days. Either party may bring an individual claim in small claims court if it qualifies. Otherwise, any
dispute will be resolved in the courts of ${t(j, 'the state and county', 'the province or territory')} where you live, and you and Bite
Wise consent to their jurisdiction. Nothing in this section takes away a right to sue in a particular court that the law gives you as a
consumer.</p>

<h2>15. General</h2>
<p>These Terms and the Privacy Policy are the entire agreement between you and Bite Wise about the Service. If any provision is found
unenforceable, the rest remains in effect. Our failure to enforce a provision is not a waiver. You may not assign these Terms; we may
assign them in connection with a merger, acquisition or sale of assets. You agree that accepting these Terms electronically has the
same effect as a handwritten signature under ${t(j,
  'the federal E-SIGN Act and the Uniform Electronic Transactions Act as adopted in your state',
  'the electronic commerce and electronic transactions laws of your province or territory')}.</p>

<h2>16. Contact</h2>
<p>${c.entity} · ${c.address} · <a href="mailto:${c.email}">${c.email}</a></p>`;
}

function restaurantAgreement(c: Company, j: Jur) {
  return `
<p class="lead">This Restaurant Partner Agreement (the "<b>Agreement</b>") is a binding agreement between ${c.entity} ("<b>Bite Wise</b>,"
"<b>we</b>," "<b>us</b>") and the food business you register (the "<b>Partner</b>," "<b>you</b>"). It governs your use of the Bite Wise
Partner Portal and marketplace to sell surplus food. By selecting <b>Accept</b> when you create a restaurant account, you confirm that
you are authorized to bind the Partner and that the Partner agrees to this Agreement and to our <a href="${j.privacy}">Privacy
Policy</a>. If you do not agree, select <b>Decline</b> and do not create an account.</p>
${t(j, `<p>This is the Agreement for restaurants located in the <b>United States</b>. Restaurants in Canada agree to the Canadian Agreement.</p>`,
  `<p>This is the Agreement for restaurants located in <b>Canada</b>. Restaurants in the United States agree to the US Agreement.</p>`)}

<h2>1. The Bite Wise marketplace</h2>
<p>1.1 Bite Wise provides an online marketplace, software and payment facilitation that let you list surplus food ("<b>Offers</b>") for
customers to buy at a discount and collect in person. You are the seller of all food you list. Bite Wise is not a food business and
does not handle, inspect, store or transport food.</p>
<p>1.2 You set the menu items, discount percentage, quantity available and discard timer for each Offer, and may pause, edit, extend
or end an Offer at any time. Orders already placed must still be honoured unless Section 4.4 applies.</p>

<h2>2. Eligibility, licences and insurance</h2>
<p>You represent and warrant, and will ensure throughout the term, that you:</p>
<ul>
${t(j, `  <li>are a legally operating business in the United States, holding all business licences, tax registrations and food
  establishment permits required by your state, county and city, and by your local health department;</li>
  <li>comply with the food code adopted by your state and local health jurisdiction and all other applicable food safety, labelling,
  health, employment and consumer protection laws;</li>
  <li>maintain commercial general liability insurance, including products-completed operations coverage, of at least
  US$1,000,000 per occurrence, and provide proof to Bite Wise on request; and</li>`,
  `  <li>are a legally operating business in Canada, holding all business licences and food premises permits required by your province
  or territory and municipality, and registered for the GST/HST (and the QST in Quebec, or provincial sales tax where it applies)
  unless you qualify as a small supplier;</li>
  <li>comply with the food safety and food premises laws of your province or territory, local public health requirements, and, where
  they apply, the Safe Food for Canadians Act and Regulations and the Food and Drugs Act, as well as all applicable labelling, health,
  employment and consumer protection laws;</li>
  <li>maintain commercial general liability insurance, including products-completed operations coverage, of at least
  CA$2,000,000 per occurrence, and provide proof to Bite Wise on request; and</li>`)}
  <li>will notify Bite Wise within 2 business days if any permit is suspended or revoked, or if you receive a health department
  closure order. Bite Wise may suspend your listings immediately in that case.</li>
</ul>

<h2>3. Food safety and listing standards</h2>
<p>3.1 <b>Only safe food.</b> You will list only food that is safe to eat at the time of sale and throughout its discard timer, and that
has been prepared, held and packaged in compliance with the food safety laws that apply to you. This includes foods that need time and
temperature control for safety (for example, hot holding at ${t(j, '135°F (57°C)', '60°C (140°F)')} or above, cold holding at
${t(j, '41°F (5°C)', '4°C (40°F)')} or below, or approved time-based procedures). You
will set the discard timer so that food will still be safe when collected, and will discard food as required by law when the timer
ends or earlier if needed.</p>
<p>3.2 <b>Accurate listings.</b> Item names, descriptions, photos, prices, ingredients and dietary tags must be accurate and not
misleading. The "original price" must be the price you genuinely charge for the item. You must disclose, in the description or on
request, the presence of ${t(j, 'major food allergens', 'priority food allergens')} (${t(j, ALLERGENS_US, ALLERGENS_CA)}), and must clearly state when a "wrong order" item differs from your standard recipe.</p>
<p>3.3 <b>Packaging.</b> Food must be packaged in clean, food-grade, closed containers suitable for transport, labelled with the item
name, and where appropriate, with reheating or storage guidance.</p>
<p>3.4 <b>No prohibited items.</b> You will not list alcohol, cannabis, tobacco, recalled products, food past a manufacturer's
"use by" date, or anything you are not licensed to sell.</p>

<h2>4. Orders, pickup and PIN verification</h2>
<p>4.1 When a customer orders, you will receive an alert in the Partner Portal. You will hold the ordered food for the customer until the
Offer's discard timer ends.</p>
<p>4.2 <b>Verify the PIN before handing over food.</b> You must enter the customer's 4-digit PIN in the Partner Portal and confirm the
order before giving the customer their food. Confirming pickup is what charges the customer's card. If you hand over food without
confirming a valid PIN, Bite Wise is not responsible for payment for that food.</p>
<p>4.3 Orders not picked up within ${c.graceMinutes} minutes after the discard timer ends are automatically released. The customer is
charged only the Bite Wise service fee, which is not refundable and which Bite Wise keeps. You are not paid for released orders or for orders
the customer cancels.</p>
<p>4.4 You may refuse or cancel an order only if the food has become unsafe or unavailable, or the customer behaves abusively. You
will cancel through Bite Wise support so the customer's payment hold is released.</p>

<h2>5. Payments, fees and payouts</h2>
<p>5.1 <b>Customer payments.</b> Bite Wise, through its payment processor Stripe, collects all payments from customers on your
behalf as your limited payment collection agent. A customer's payment to Bite Wise satisfies the customer's obligation to you.</p>
<p>5.2 <b>Your proceeds.</b> For each completed order you are entitled to the food subtotal (the discounted price times quantity)
<b>plus the sales tax charged on that food</b>, unless Bite Wise collects and remits that tax under Section 5.4.
Bite Wise charges Partners <b>no commission</b> on orders. Customers pay a separate Bite Wise service fee (currently
${feeText(c, j)}), which Bite Wise keeps and which is <b>not refundable</b> to the customer, whether or not the order is picked up.
Partners pay the subscription fee in Section 5.6. We will give you at least 30 days'
written notice before introducing or changing any fee charged to Partners.</p>
<p>5.3 <b>Payouts through Stripe Connect.</b> Payouts are made through Stripe Connect. To be paid, you must create and verify a
Stripe Express account from the Partner Portal (Payouts tab) and keep it in good standing. By doing so you also agree to the
<a href="https://stripe.com/connect-account/legal" target="_blank" rel="noopener">Stripe Connected Account Agreement</a>, which
includes the Stripe Services Agreement.</p>
<ul>
  <li><b>When you are paid:</b> when you confirm a pickup with the customer's PIN, your proceeds for that order are transferred to
  your Stripe account. Stripe then pays your available balance to the bank account you gave Stripe, on your Stripe payout schedule.
  If your Stripe account is not yet set up, Bite Wise holds your proceeds and transfers them once it is.</li>
  <li><b>Identity and bank details:</b> Stripe collects and verifies your identity and bank details (know-your-customer). Bite Wise does
  not store your full bank account number and is not responsible for a payout sent to the bank details you gave Stripe.</li>
  <li><b>Payout records:</b> each transfer is documented with a system-generated invoice number, the receiving account (shown
  masked) and the Stripe transaction ID. These records cannot be altered, and they appear in your Partner Portal so you can match
  each deposit.</li>
  <li><b>Questions:</b> raise any question about a payout within 60 days.</li>
</ul>
${t(j, `<p>5.4 <b>Taxes.</b> Sales tax on each order is charged at the rate for your restaurant's address, which Bite Wise looks up
automatically from the address in your profile; keep that address accurate.</p>
<ul>
  <li><b>Sales tax on your food is paid to you.</b> It is included in your payout for each completed order, and it is shown on your
  daily report ("Sales tax paid to you"). <b>You are responsible for reporting and remitting it</b> to your state and local tax
  authorities.</li>
  <li><b>Marketplace facilitator.</b> If the law of your state requires Bite Wise to collect and remit sales tax on marketplace sales
  (for example once Bite Wise's sales in your state pass the legal threshold), Bite Wise will tell you in writing at least 14 days
  in advance where possible. From then on, Bite Wise keeps the sales tax on new orders and remits it, and your proceeds are the food
  subtotal only.</li>
  <li>Bite Wise remits any sales tax on its own service fee and on your subscription. You remain responsible for all other taxes on
  your business, such as gross receipts or business and occupation taxes on your proceeds, and income taxes.</li>
</ul>`, `<p>5.4 <b>Taxes.</b> Sales taxes on each order are charged for the province or territory of your restaurant's address: the GST or
HST, and any provincial sales tax on restaurant meals (PST, RST or QST). Bite Wise sets the rate from the address in your profile; keep
it accurate.</p>
<ul>
  <li><b>Sales tax on your food is paid to you.</b> It is included in your payout for each completed order, and it is shown on your
  daily report ("Sales tax paid to you"). <b>You are responsible for reporting and remitting it</b> to the Canada Revenue Agency, to
  Revenu Québec, and to your provincial tax authority, as they apply to you. If you are a small supplier not registered for the GST/HST,
  tell us before you list Offers.</li>
  <li><b>Platform operator.</b> If the Excise Tax Act or a provincial law requires Bite Wise to collect and remit tax on sales made
  through the marketplace, Bite Wise will tell you in writing at least 14 days in advance where possible. From then on, Bite Wise keeps
  that tax on new orders and remits it, and your proceeds are the food subtotal only.</li>
  <li>Bite Wise remits any tax on its own service fee and on your subscription. You remain responsible for all other taxes on your
  business, including income taxes.</li>
</ul>`)}
<p>5.5 <b>Sold as is; all sales final; courtesy refunds; chargebacks.</b> Food is sold to customers <b>as is</b>, and <b>all sales are
final</b>: customers have no right to a refund once you have confirmed a pickup with their PIN (Customer Terms, Section 6), and you do not
give refunds yourself. Do not hand over food that is unsafe, spoiled or not what was ordered: cancel the order through Bite Wise support
instead, so the customer is not charged and you are not paid for it. Bite Wise may, case by case and at its discretion, give a customer a
courtesy refund (for example for a genuine problem with the food, or for loyalty), and will share the customer's complaint with you first
where it can:</p>
<ul>
  <li><b>(a) Courtesy refund to the customer's original form of payment.</b> The refunded share of what you were paid for the order (the
  food, and its sales tax when it was paid to you) is taken back from you, by reversing the transfer for that order or deducting it from
  future payouts. The customer's service fee is never refunded. Bite Wise will also give any refund a law that cannot be waived requires,
  on the same terms.</li>
  <li><b>(b) Courtesy Platform Credit.</b> Platform Credit, including goodwill credit, is funded solely by Bite Wise. You keep your full
  proceeds for the order, and nothing is deducted from your payouts.</li>
</ul>
<p>When a customer pays for an order with Platform Credit, in whole or in part, you receive your full proceeds for that order exactly as
if it had been paid by card. Bite Wise bears the cost of the credit. If a payment is reversed through a chargeback caused by your acts or
omissions, the corresponding amount is deducted from your future payouts.</p>

<p>5.6 <b>Subscription.</b> To list Offers, an approved Partner needs an active Bite Wise plan:</p>
<ul>
  <li><b>Pioneer Members.</b> The first ${c.foundingSpots} restaurants to choose a plan on Bite Wise become Pioneer Members: their
  monthly or annual plan is free for as long as this Agreement continues and the membership stays active. Each period you receive an
  invoice that shows the plan price, a Pioneer Members Discount of the same amount, and a total of $0.00; no card is needed. Pioneer
  status is personal to your restaurant and can't be transferred.</li>
  <li><b>Monthly plan:</b> ${usd(c.monthlyPrice)} per month. <b>Annual plan:</b> ${usd(c.annualPrice)} per year, paid in advance
  (${usd(c.monthlyPrice * 12 - c.annualPrice)} less than twelve monthly payments). ${t(j, 'Prices are in U.S. dollars and exclude taxes.', 'Prices are in Canadian dollars and exclude taxes.')} Orders at the Restaurant, plan fees and payouts are in the currency of the Restaurant's country.</li>
  <li><b>Sales tax.</b> ${t(j, `Sales tax is added to every plan payment at the Washington rate for Bite Wise's location, is shown
  separately on each invoice, and is collected and remitted by Bite Wise.`, `HST is added to every plan payment at the Newfoundland and
  Labrador rate for Bite Wise's location, is shown separately on each invoice, and is collected and remitted by Bite Wise.`)} A Pioneer Member's $0.00 plan has no sales tax.</li>
  <li><b>Card on file and automatic renewal.</b> You keep at least one payment card on file in the Partner Portal while a paid plan
  renews automatically. Paid plans renew automatically at the end of each period, for the same length, and your default card on file
  is charged the plan price then in effect, plus sales tax. You can turn automatic renewal off at any time in the Partner Portal (Plan tab); your plan then
  ends at the end of the period you have paid for. Before each renewal we email you a reminder (about 30 days ahead for annual plans and 7 days ahead for monthly plans) with the amount, the date and the card that will be charged. We will email you at least 30 days before any price change takes effect (at 12:01 AM Pacific Time on the
  effective date) and tell you whether it applies to your plan. If it does, it applies from your first renewal on or after
  that date; if we tell you that existing partners keep their current price, your price stays the same for as long as your
  plan stays active.</li>
  <li><b>Declined payments.</b> If a payment is declined, your plan becomes <b>delinquent</b> straight away: your Offers are paused and
  you cannot post or turn on Offers until a payment for your plan succeeds. We will tell you by email and retry your card on file
  automatically for up to 7 days; you can also pay at any time from the Plan tab with any card. Your new plan period starts when the
  payment succeeds.</li>
  <li><b>Subscription fees are not refundable.</b> Plan fees already paid, including the sales tax on them, are not refunded, in whole or in
  part, for any reason: this includes unused parts of a monthly or annual period, turning off automatic renewal, a paused, suspended or
  delinquent plan, and the end of this Agreement by either party. If you turn off automatic renewal or this Agreement ends, your plan
  simply runs to the end of the period you have paid for and is not renewed. This applies except where the law requires a refund.</li>
</ul>
<p>5.7 <b>Bite Wise coupons.</b> From time to time Bite Wise issues promotional coupons to customers, which customers can use on your
Offers. You agree to honour them as follows:</p>
<ul>
  <li><b>Coupons that take money off the food</b> (a fixed amount or a percentage, never more than the food's price) are <b>paid by
  you</b>. The discount lowers the food subtotal of that order, so your proceeds for the order (Section 5.2), and the sales tax on the food,
  are calculated on the price after the coupon. In other words, the coupon amount is deducted from the money you receive for that order.</li>
  <li><b>Coupons that waive the Bite Wise service fee</b> ("No Service Fee" coupons) are <b>paid by Bite Wise</b> and do not change your
  proceeds.</li>
  <li>Bite Wise decides when to issue coupons, their value, the customers who receive them and their expiration dates. Each coupon applies
  to one order, once per customer, in the country it was issued for.</li>
  <li>Every coupon used on one of your orders is shown with that order at pickup, in your Orders tab and on your daily sales report, and
  your payouts reflect it.</li>
  <li>A coupon is part of the customer's price, not a refund: Section 5.5 still applies to the order.</li>
</ul>

<h2>6. Content and licence</h2>
<p>You grant Bite Wise a non-exclusive, royalty-free, worldwide licence, for the term of this Agreement, to use, reproduce, display and
adapt your business name, logo, menu information and photos you upload, solely to operate and promote the Bite Wise marketplace. You
represent that you own or have permission to use all content you upload, and that it does not infringe anyone's rights.</p>

<h2>7. Customer data</h2>
<p>You will receive limited customer information (such as username, order details and pickup time) solely to fulfil orders. You will
not use it for any other purpose, contact customers for marketing, or sell or share it, and you will protect it with reasonable
security measures${t(j, '', ', and you will comply with the Personal Information Protection and Electronic Documents Act (PIPEDA) and any provincial privacy law that applies to you')}. Bite Wise's handling of personal information is described in the <a href="${j.privacy}">Privacy Policy</a>.</p>

<h2>8. Account security and conduct</h2>
<p>You are responsible for keeping your Partner Portal login secure and for all activity under it, including by your staff. You will
not manipulate prices, create fake orders or reviews, or use the marketplace for anything other than selling genuine surplus food.</p>

<h2>9. Indemnification</h2>
<p>You will defend, indemnify and hold harmless Bite Wise and its officers, employees and agents from any claims, damages, losses,
penalties and expenses (including reasonable ${t(j, "attorneys' fees", 'legal fees')}) arising out of or related to: (a) food you sell, including foodborne
illness, allergic reaction or injury; (b) your breach of this Agreement or of law; (c) inaccurate listings; or (d) content you upload.</p>

<h2>10. Disclaimers and limitation of liability</h2>
<p>10.1 The marketplace and software are provided "as is." Bite Wise does not guarantee any level of sales or that the service will be
uninterrupted or error-free.</p>
<p>10.2 To the fullest extent permitted by law, neither party will be liable for indirect, incidental, special, consequential or
punitive damages or lost profits. Except for your obligations under Sections 3 and 9 and amounts owed under Section 5, each party's
total liability under this Agreement is limited to the amounts paid or payable to you under this Agreement in the 12 months before
the claim arose.</p>

<h2>11. Term and termination</h2>
<p>This Agreement starts when you accept it and continues until terminated. Either party may terminate for convenience with 14 days'
written notice. Bite Wise may suspend your restaurant (for a set number of days) or terminate immediately and permanently remove it
from Bite Wise (a ban) if you breach Sections 2, 3, 7 or 8, if food safety is at risk, or if required by law. A banned Partner may not
open a new Partner or customer account. On termination, your Offers are removed, open orders are cancelled and released, and Bite Wise will pay out amounts
owed for completed orders, less adjustments under Section 5.5. Subscription fees already paid are not refunded (Section 5.6).</p>

<h2>12. Changes</h2>
<p>We may update this Agreement. We will give you at least 30 days' notice of material changes by email or in the Partner Portal, and
ask you to accept the new version. If you do not accept, you may terminate under Section 11.</p>

<h2>13. General</h2>
<p>You and Bite Wise are independent contractors; nothing in this Agreement creates a partnership, joint venture, franchise or
employment relationship. ${t(j,
  `This Agreement is governed by the laws of the state where your restaurant is located (for a Partner with restaurants in more than one
state, the state of its main location) and applicable United States federal law, and the parties consent to the jurisdiction of the
state and federal courts of that state.`,
  `This Agreement is governed by the laws of the province or territory where your restaurant is located (for a Partner with restaurants
in more than one, the province or territory of its main location) and the federal laws of Canada that apply there, and the parties
consent to the jurisdiction of the courts of that province or territory.`)} You may not assign this Agreement without our consent. If any
provision is unenforceable, the rest remains in effect. This Agreement, together with the Privacy Policy, is the entire agreement
between the parties about its subject. Electronic acceptance has the same effect as a signature under ${t(j,
  'the federal E-SIGN Act and the Uniform Electronic Transactions Act as adopted in your state',
  'the electronic commerce and electronic transactions laws of your province or territory')}.</p>

<h2>14. Contact</h2>
<p>${c.entity} · ${c.address} · <a href="mailto:${c.email}">${c.email}</a></p>`;
}

function privacyPolicy(c: Company, j: Jur) {
  return `
<p class="lead">This Privacy Policy explains how ${c.entity} ("<b>Bite Wise</b>," "<b>we</b>") collects, uses and shares personal information
when you use the Bite Wise website and services as a customer or restaurant partner${t(j, ' in the United States', ' in Canada')}.
${t(j, '', `It is written to meet the Personal Information Protection and Electronic Documents Act (PIPEDA) and, where they apply, the
private-sector privacy laws of Alberta, British Columbia and Quebec (including Quebec's Law 25). By creating an account you consent to the
collection, use and disclosure of your personal information as described here; you can withdraw your consent at any time (Section 7),
although we may then be unable to provide the service.`)}</p>

<h2>1. Information we collect</h2>
<ul>
  <li><b>Account information:</b> email address, user name and a securely hashed password (stored by our authentication provider,
  Supabase). For restaurant partners, business name, address, phone number, cuisine, map location, sales-tax rate, menus and photos.</li>
  <li><b>Orders:</b> items, quantities, prices, fees, taxes, pickup PIN, order status and timestamps.</li>
  <li><b>Payment information:</b> card numbers are collected and processed by our payment processor (Stripe) and never stored on
  Bite Wise servers. We store a processor reference and the card brand, last four digits and expiry date so you can recognise saved
  cards and receipts.</li>
  <li><b>Payouts (restaurant partners):</b> payouts are made through Stripe Connect. Stripe collects and verifies the partner's
  identity and bank account. Bite Wise stores only the Stripe account ID, whether payouts are enabled, and a masked description of
  the bank account (bank name and last four digits) for payout records.</li>
  <li><b>Platform Credit:</b> a ledger of credit issued to you, used on orders and returned, with dates and reasons.</li>
  <li><b>Location:</b> if you choose "Use my location," your browser shares your approximate location with us to show nearby deals.
  We use it for that search and do not store it on our servers. You can also search by city or ${t(j, 'ZIP code', 'postal code')} instead.</li>
  <li><b>Where you are:</b> the country, ${t(j, 'state', 'province or territory')} and city you give when you sign up, so we can show you the
  right terms and taxes.</li>
  <li><b>Legal acceptances:</b> which versions of our terms you accepted, when, and the IP address and browser used, as a record
  of your agreement.</li>
  <li><b>Technical information:</b> IP address, browser type and server logs needed to operate and secure the service.</li>
</ul>

<h2>2. How we use information</h2>
<p>We use personal information to create and secure accounts; show deals; process orders, payment holds, charges and refunds; send
receipts and service messages; let restaurants fulfil orders; prevent fraud and abuse (for example, limiting PIN and login attempts);
comply with tax, accounting and other legal obligations; and improve the service. We do not sell personal information and do not use
it for targeted advertising.</p>

<h2>3. How we share information</h2>
<ul>
  <li><b>With restaurants:</b> when you order, the restaurant sees your user name, the order details and the order status, but not
  your email address or full card details.</li>
  <li><b>With service providers:</b> our payment processor (Stripe), our database, authentication and file storage provider
  (Supabase), and our hosting, email and map providers, only as needed to provide the service and under confidentiality obligations. Maps load tiles from a map provider (by default, OpenStreetMap), which receives your IP
  address when your browser requests map images.</li>
  <li><b>For legal reasons:</b> to comply with law, legal process or requests from government authorities (including ${t(j,
    'state and local tax authorities', 'the Canada Revenue Agency, Revenu Québec and provincial tax authorities')} for tax purposes), or to
  protect the rights, safety and property of users, restaurants or Bite Wise.</li>
  <li><b>Business transfers:</b> in connection with a merger, acquisition or sale of assets, subject to this Policy.</li>
</ul>

${t(j, '', `<p><b>Information stored outside Canada.</b> Bite Wise and several of its service providers (including Supabase, Stripe and our
hosting provider) store and process information in the United States. While it is there, it is protected by contracts and security
measures, but it may be accessed by courts, law enforcement and national security authorities of that country under its laws.</p>`)}

<h2>4. Cookies</h2>
<p>We use essential cookies to keep you signed in (your authentication session). They are not used for tracking. Your browser's local storage
may remember simple preferences such as list or map view and whether order sounds are on. We do not use advertising or analytics
cookies.</p>

<h2>5. Retention</h2>
<p>We keep account information while your account is open. We keep order, payment and tax records for at least 7 years, as needed for
accounting and tax obligations, and records of terms acceptance for as long as the agreement applies plus the applicable limitation
period. Sign-in sessions expire automatically.</p>

<h2>6. Security</h2>
<p>We use industry-standard measures including encrypted connections (HTTPS), hashed passwords, database row-level access controls,
rate limiting and a payment processor certified to PCI DSS. No system is completely secure; please use a strong, unique password.</p>

<h2>7. Your choices and rights</h2>
<p>You can review and update your information, remove saved cards, and close your account. You may ask us to access, correct, export or
delete your personal information by emailing <a href="mailto:${c.email}">${c.email}</a>. We will respond within 30 days and may need to
verify your identity. We may keep information we are legally required to retain. We will not discriminate against you for exercising
these rights.</p>
${t(j, `<p>If you live in a state with a consumer privacy law (such as California, Colorado, Connecticut, Virginia or Washington's My
Health My Data Act), you may have additional rights under it, and you can exercise them the same way. We do not sell or share personal
information for targeted advertising.</p>`, `<p>You may withdraw your consent, subject to legal or contractual limits, and ask us how your information is used and
shared. Our Privacy Officer is responsible for our compliance and can be reached at <a href="mailto:${c.email}">${c.email}</a>. If you
are not satisfied with our answer, you may complain to the Office of the Privacy Commissioner of Canada or, where it applies, your
provincial privacy commissioner (such as Quebec's Commission d'accès à l'information). We send service emails about your account and
orders; we send promotional emails only with your consent, as required by Canada's Anti-Spam Legislation (CASL), and every one has a way
to unsubscribe.</p>`)}

<h2>8. Children</h2>
<p>The service is not directed to children. ${t(j,
  'You must be at least 18 to create a customer account. We do not knowingly collect personal information from children under 13',
  'You must have reached the age of majority in your province or territory to create a customer account. We do not knowingly collect personal information from minors')}; if you believe we have, contact us and we will delete it.</p>

<h2>9. Changes</h2>
<p>We may update this Policy. We will post the new version with a new effective date and, for material changes, notify you and ask you
to review it before continuing to use the service.</p>

<h2>10. Contact</h2>
<p>${c.entity} · ${c.address} · <a href="mailto:${c.email}">${c.email}</a></p>`;
}

export const DOCUMENTS = {
  'customer-terms': { title: 'Customer Terms of Service', country: 'US', render: (c: Company) => customerTerms(c, US) },
  'restaurant-agreement': { title: 'Restaurant Partner Agreement', country: 'US', render: (c: Company) => restaurantAgreement(c, US) },
  privacy: { title: 'Privacy Policy', country: 'US', render: (c: Company) => privacyPolicy(c, US) },
  'customer-terms-ca': { title: 'Customer Terms of Service (Canada)', country: 'CA', render: (c: Company) => customerTerms(c, CA) },
  'restaurant-agreement-ca': { title: 'Restaurant Partner Agreement (Canada)', country: 'CA', render: (c: Company) => restaurantAgreement(c, CA) },
  'privacy-ca': { title: 'Privacy Policy (Canada)', country: 'CA', render: (c: Company) => privacyPolicy(c, CA) },
} as const;

export type DocumentId = keyof typeof DOCUMENTS;

// The same document in the other country's set (for the country switch on the legal pages).
export const COUNTERPART: Record<DocumentId, DocumentId> = {
  'customer-terms': 'customer-terms-ca', 'customer-terms-ca': 'customer-terms',
  'restaurant-agreement': 'restaurant-agreement-ca', 'restaurant-agreement-ca': 'restaurant-agreement',
  privacy: 'privacy-ca', 'privacy-ca': 'privacy',
};

// Documents each role must accept, by country.
type SigningRole = Exclude<Role, 'admin'>;
const REQUIRED_US: Record<SigningRole, DocumentId[]> = {
  customer: ['customer-terms', 'privacy'],
  restaurant: ['restaurant-agreement', 'privacy'],
  // Staff work under their restaurant's agreement, accepted by the owner.
  staff: [],
  // Admin employees work for Bite Wise.
  support: [],
};
const REQUIRED_CA: Record<SigningRole, DocumentId[]> = {
  customer: ['customer-terms-ca', 'privacy-ca'],
  restaurant: ['restaurant-agreement-ca', 'privacy-ca'],
  staff: [],
  support: [],
};
export const requiredIds = (role: SigningRole, country: Country = 'US') => (country === 'CA' ? REQUIRED_CA : REQUIRED_US)[role];

export type LegalDocument = { id: DocumentId; title: string; version: string; effective: string; html: string; country: Country };

export function renderDocument(id: string, company: Company): LegalDocument | null {
  if (!(id in DOCUMENTS)) return null;
  const def = DOCUMENTS[id as DocumentId];
  const c = { ...company, entity: esc(company.entity), email: esc(company.email), address: esc(company.address) };
  return { id: id as DocumentId, title: def.title, version: LEGAL_VERSION, effective: EFFECTIVE, html: def.render(c), country: def.country };
}

export const requiredDocuments = (role: SigningRole, country: Country = 'US') =>
  requiredIds(role, country).map((id) => ({ id, title: DOCUMENTS[id].title, version: LEGAL_VERSION }));

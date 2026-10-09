// Bite Wise legal documents. Each document has a version; users must accept the current version of
// every document required for their role before their account is created, and again whenever a
// version changes. When you edit the text, change LEGAL_VERSION and EFFECTIVE here AND the versions
// in the legal_documents table (add a migration); a test checks that they match.
//
// Company details come from LEGAL_ENTITY_NAME, SUPPORT_EMAIL and LEGAL_ADDRESS. Have a
// Washington-licensed attorney review these documents before launch.

import type { Role } from '@/lib/constants';

export const LEGAL_VERSION = '2026-10-12.1';
export const EFFECTIVE = 'October 12, 2026';

export type Company = {
  entity: string; email: string; address: string; serviceFeePct: number; graceMinutes: number;
  // Restaurant subscription: prices in dollars, and how many Pioneer Member (free) spots there are.
  monthlyPrice: number; annualPrice: number; foundingSpots: number;
};

const usd = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] as string);

function customerTerms(c: Company) {
  return `
<p class="lead">Welcome to Bite Wise. These Customer Terms of Service (the "<b>Terms</b>") are a binding agreement between you and ${c.entity}
("<b>Bite Wise</b>," "<b>we</b>," "<b>us</b>") and govern your use of the Bite Wise website and services (the "<b>Service</b>") to find and buy
discounted surplus food from participating restaurants. By selecting <b>Accept</b> when you create an account, or by using the Service,
you agree to these Terms and to our <a href="/legal/privacy">Privacy Policy</a>. If you do not agree, select <b>Decline</b> and do not use the Service.</p>

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
<p>2.1 You must be at least 18 years old and able to form a binding contract to create an account. The Service is available only in
the areas we serve in Washington State.</p>
<p>2.2 You agree to give accurate information (including a valid email address), to keep your password confidential, and to be
responsible for all activity on your account. Tell us immediately at <a href="mailto:${c.email}">${c.email}</a> if you believe your account
has been used without your permission. You may have only one customer account.</p>

<h2>3. Allergens, dietary information and food safety</h2>
<p>3.1 <b>Restaurants supply all food information.</b> Item names, descriptions, photos, ingredients and dietary tags (such as
"vegan" or "gluten-free") are provided by the Restaurant. Bite Wise does not verify them and does not guarantee that food is free of any
allergen.</p>
<p>3.2 <b>If you have a food allergy or dietary restriction, ask the Restaurant before you eat.</b> Surplus food may have been
prepared in kitchens that handle common allergens, including milk, eggs, fish, shellfish, tree nuts, peanuts, wheat, soy and sesame,
and "wrong order" items may contain ingredients that differ from the regular menu. Do not buy or eat an item if you are unsure it is
safe for you.</p>
<p>3.3 Inspect food when you pick it up. If it appears unsafe, spoiled or not as described, do not accept or eat it, and report it to us
as described in Section 6.</p>
<p>3.4 Each Restaurant is responsible for complying with food safety laws, including the Washington State Retail Food Code and local
health department rules.</p>

<h2>4. Ordering, pricing and payment</h2>
<p>4.1 <b>Prices.</b> Before you place an order, we show you the item's original price, the Restaurant's discount, the discounted
price, a Bite Wise service fee (currently ${c.serviceFeePct}% of the food subtotal), applicable sales tax, and the total.
Prices are in U.S. dollars.</p>
<p>4.2 <b>Payment authorization.</b> When you place an order, we (through our payment processor) place a temporary authorization hold
on your debit or credit card for the order total. <b>Your card is charged only when the Restaurant confirms pickup by entering your
PIN.</b> If an order is cancelled or not picked up, the hold is released and you are not charged. Your card issuer controls how long
it takes for a released hold to disappear from your statement.</p>
<p>4.3 <b>Saved cards.</b> If you choose to save a card, you authorize us and our payment processor to store it securely and to use
it for future orders you place. Card numbers are handled by our payment processor. Bite Wise stores only the card brand, last four
digits and expiry date. You can remove a saved card at any time on your Account page.</p>
<p>4.4 <b>Order confirmation.</b> An order is confirmed when you receive a 4-digit pickup PIN. The Restaurant may decline or cancel an
order it cannot fulfil (for example, if food is found to be unsuitable), in which case you will not be charged.</p>
<p>4.5 <b>Taxes.</b> Because you pick your order up at the Restaurant, sales tax is charged at the rate that applies at the
Restaurant's address (state, county, city and any local taxes), which we calculate automatically. Where Bite Wise is required to do so
as a marketplace facilitator, Bite Wise collects sales tax on your order and remits it to the state tax authority.</p>

<h2>5. Pickup, PIN and the discard timer</h2>
<p>5.1 Each Offer has a discard timer set by the Restaurant. You must pick up your order at the Restaurant before the timer ends. If
you do not, the Restaurant may discard the food, your order will be released ${c.graceMinutes} minutes after the timer ends, and you will
not be charged.</p>
<p>5.2 Your PIN is how the Restaurant confirms that you are the buyer. <b>Keep it private.</b> Anyone who presents your PIN may
receive your order, and your card will be charged when the Restaurant enters it. Bite Wise is not responsible for orders collected by
someone using a PIN you shared.</p>
<p>5.3 You may cancel an order at no charge from the My Orders page at any time before it is picked up.</p>
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

<h2>6. Problems with an order and refunds</h2>
<p>6.1 If your food was not provided, was materially different from its description, or appeared unsafe, contact us at
<a href="mailto:${c.email}">${c.email}</a> within 24 hours of pickup with your receipt number and a description (and photos if possible).
We will review your request with the Restaurant and, where appropriate, issue a full or partial refund. Bite Wise decides the refund
method, and will tell you which one it used:</p>
<ul>
  <li><b>Original form of payment.</b> The refund goes back to how you paid: to the card you used, and if you paid with Platform Credit,
  that portion is returned to your credit balance. Card refunds usually appear within 5 to 10 business days, depending on your card
  issuer.</li>
  <li><b>Bite Wise Platform Credit.</b> The refund is added to your Platform Credit balance for future orders (see Section 6.4).</li>
</ul>
<p>Where applicable law requires a refund to your original form of payment, we will refund it that way.</p>
<p>6.2 Because surplus food is sold at a discount in the condition described, we cannot offer refunds for matters of taste or
preference, or for food that matched its description.</p>
<p>6.3 Nothing in these Terms limits any right you have under the Washington Consumer Protection Act (RCW 19.86) or other laws that
cannot be waived.</p>
<p>6.4 <b>Bite Wise Platform Credit.</b> Platform Credit is a promotional and refund balance issued by Bite Wise, at its discretion,
to your account.</p>
<ul>
  <li><b>Where you see it:</b> your balance appears in the site header, on your Account page (with a history of every credit and use),
  and at checkout.</li>
  <li><b>Using it:</b> you choose whether to use it and how much, up to your balance and the order total. Any remainder is charged to
  your card, and the card portion must be at least $0.50.</li>
  <li><b>Unused orders:</b> credit applied to an order that is cancelled, declined or not picked up is returned to your balance.</li>
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
<p>You agree to indemnify and hold Bite Wise harmless from claims, losses and expenses (including reasonable attorneys' fees) arising
from your misuse of the Service or your violation of these Terms or the law.</p>

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
<p>14.1 These Terms are governed by the laws of the State of Washington, without regard to its conflict-of-law rules.</p>
<p>14.2 Before filing a claim, you agree to contact us at <a href="mailto:${c.email}">${c.email}</a> and try to resolve the dispute
informally for at least 30 days. Either party may bring an individual claim in small claims court if it qualifies. Otherwise, any
dispute will be resolved exclusively in the state or federal courts located in King County, Washington, and you and Bite Wise consent
to their jurisdiction.</p>

<h2>15. General</h2>
<p>These Terms and the Privacy Policy are the entire agreement between you and Bite Wise about the Service. If any provision is found
unenforceable, the rest remains in effect. Our failure to enforce a provision is not a waiver. You may not assign these Terms; we may
assign them in connection with a merger, acquisition or sale of assets. You agree that accepting these Terms electronically has the
same effect as a handwritten signature under the Washington Uniform Electronic Transactions Act (RCW 1.80) and the federal E-SIGN Act.</p>

<h2>16. Contact</h2>
<p>${c.entity} · ${c.address} · <a href="mailto:${c.email}">${c.email}</a></p>`;
}

function restaurantAgreement(c: Company) {
  return `
<p class="lead">This Restaurant Partner Agreement (the "<b>Agreement</b>") is a binding agreement between ${c.entity} ("<b>Bite Wise</b>,"
"<b>we</b>," "<b>us</b>") and the food business you register (the "<b>Partner</b>," "<b>you</b>"). It governs your use of the Bite Wise
Partner Portal and marketplace to sell surplus food. By selecting <b>Accept</b> when you create a restaurant account, you confirm that
you are authorized to bind the Partner and that the Partner agrees to this Agreement and to our <a href="/legal/privacy">Privacy
Policy</a>. If you do not agree, select <b>Decline</b> and do not create an account.</p>

<h2>1. The Bite Wise marketplace</h2>
<p>1.1 Bite Wise provides an online marketplace, software and payment facilitation that let you list surplus food ("<b>Offers</b>") for
customers to buy at a discount and collect in person. You are the seller of all food you list. Bite Wise is not a food business and
does not handle, inspect, store or transport food.</p>
<p>1.2 You set the menu items, discount percentage, quantity available and discard timer for each Offer, and may pause, edit, extend
or end an Offer at any time. Orders already placed must still be honoured unless Section 4.4 applies.</p>

<h2>2. Eligibility, licences and insurance</h2>
<p>You represent and warrant, and will ensure throughout the term, that you:</p>
<ul>
  <li>are a legally operating business in Washington State, holding a current Washington business licence, UBI number and all
  food establishment permits required by the Washington State Department of Health and your local health jurisdiction
  (such as Public Health – Seattle &amp; King County or the Tacoma-Pierce County Health Department);</li>
  <li>comply with the Washington State Retail Food Code (WAC 246-215) and all other applicable food safety, labelling, health,
  employment and consumer protection laws;</li>
  <li>maintain commercial general liability insurance, including products-completed operations coverage, of at least
  $1,000,000 per occurrence, and provide proof to Bite Wise on request; and</li>
  <li>will notify Bite Wise within 2 business days if any permit is suspended or revoked, or if you receive a health department
  closure order. Bite Wise may suspend your listings immediately in that case.</li>
</ul>

<h2>3. Food safety and listing standards</h2>
<p>3.1 <b>Only safe food.</b> You will list only food that is safe to eat at the time of sale and throughout its discard timer, and that
has been prepared, held and packaged in compliance with the Food Code. This includes time and temperature control for safety (TCS)
foods (for example, hot holding at 135°F or above, cold holding at 41°F or below, or time-as-a-public-health-control procedures). You
will set the discard timer so that food will still be safe when collected, and will discard food as required by law when the timer
ends or earlier if needed.</p>
<p>3.2 <b>Accurate listings.</b> Item names, descriptions, photos, prices, ingredients and dietary tags must be accurate and not
misleading. The "original price" must be the price you genuinely charge for the item. You must disclose, in the description or on
request, the presence of major food allergens (milk, eggs, fish, crustacean shellfish, tree nuts, peanuts, wheat, soybeans and
sesame), and must clearly state when a "wrong order" item differs from your standard recipe.</p>
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
<p>4.3 Orders not picked up within ${c.graceMinutes} minutes after the discard timer ends are automatically released and the customer is
not charged. You are not paid for released orders.</p>
<p>4.4 You may refuse or cancel an order only if the food has become unsafe or unavailable, or the customer behaves abusively. You
will cancel through Bite Wise support so the customer's payment hold is released.</p>

<h2>5. Payments, fees and payouts</h2>
<p>5.1 <b>Customer payments.</b> Bite Wise, through its payment processor Stripe, collects all payments from customers on your
behalf as your limited payment collection agent. A customer's payment to Bite Wise satisfies the customer's obligation to you.</p>
<p>5.2 <b>Your proceeds.</b> For each completed order you are entitled to the food subtotal (the discounted price times quantity).
Bite Wise charges Partners <b>no commission</b> on orders. Customers pay a separate Bite Wise service fee (currently ${c.serviceFeePct}% of
the food subtotal), which Bite Wise keeps. Partners pay the subscription fee in Section 5.6. We will give you at least 30 days'
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
<p>5.4 <b>Taxes.</b> Sales tax on each order is charged at the rate for your restaurant's address, which Bite Wise looks up
automatically from the address in your profile; keep that address accurate. Where Bite Wise is a marketplace facilitator under the
law of your state, Bite Wise will collect and remit sales tax on sales made through the marketplace. You remain responsible for all
other taxes on your business, such as gross receipts or business and occupation taxes on your proceeds, and income taxes.</p>
<p>5.5 <b>Refunds, Platform Credit and chargebacks.</b> Bite Wise will share a customer's complaint with you and consider your response
before deciding on a refund. Bite Wise may resolve a complaint in one of two ways:</p>
<ul>
  <li><b>(a) Refund to the customer's original form of payment.</b> The refunded share of the food subtotal is taken back from you,
  by reversing the transfer for that order or deducting it from future payouts, and you receive nothing for the refunded portion.
  Bite Wise likewise gives up its service fee on that portion.</li>
  <li><b>(b) Bite Wise Platform Credit.</b> Bite Wise may instead issue the customer Platform Credit. Platform Credit, including goodwill
  credit, is funded solely by Bite Wise. You keep your full proceeds for the order, and nothing is deducted from your payouts.</li>
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
  (${usd(c.monthlyPrice * 12 - c.annualPrice)} less than twelve monthly payments). Prices are in US dollars and exclude taxes.</li>
  <li><b>Sales tax.</b> Where your state taxes software subscriptions, sales tax is added to every plan payment at the combined
  state and local rate for your restaurant's location, and is shown separately on each invoice. Bite Wise collects it and remits it to
  the state tax authority. A Pioneer Member's $0.00 plan has no sales tax.</li>
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
  <li><b>No partial refunds.</b> Fees already paid are not refunded for unused parts of a period, except where the law requires or
  where Bite Wise ends this Agreement for convenience, in which case we refund the unused part of a prepaid period.</li>
</ul>

<h2>6. Content and licence</h2>
<p>You grant Bite Wise a non-exclusive, royalty-free, worldwide licence, for the term of this Agreement, to use, reproduce, display and
adapt your business name, logo, menu information and photos you upload, solely to operate and promote the Bite Wise marketplace. You
represent that you own or have permission to use all content you upload, and that it does not infringe anyone's rights.</p>

<h2>7. Customer data</h2>
<p>You will receive limited customer information (such as username, order details and pickup time) solely to fulfil orders. You will
not use it for any other purpose, contact customers for marketing, or sell or share it, and you will protect it with reasonable
security measures. Bite Wise's handling of personal information is described in the <a href="/legal/privacy">Privacy Policy</a>.</p>

<h2>8. Account security and conduct</h2>
<p>You are responsible for keeping your Partner Portal login secure and for all activity under it, including by your staff. You will
not manipulate prices, create fake orders or reviews, or use the marketplace for anything other than selling genuine surplus food.</p>

<h2>9. Indemnification</h2>
<p>You will defend, indemnify and hold harmless Bite Wise and its officers, employees and agents from any claims, damages, losses,
penalties and expenses (including reasonable attorneys' fees) arising out of or related to: (a) food you sell, including foodborne
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
owed for completed orders, less adjustments under Section 5.5.</p>

<h2>12. Changes</h2>
<p>We may update this Agreement. We will give you at least 30 days' notice of material changes by email or in the Partner Portal, and
ask you to accept the new version. If you do not accept, you may terminate under Section 11.</p>

<h2>13. General</h2>
<p>You and Bite Wise are independent contractors; nothing in this Agreement creates a partnership, joint venture, franchise or
employment relationship. This Agreement is governed by the laws of the State of Washington, and the parties consent to the exclusive
jurisdiction of the state and federal courts in King County, Washington. You may not assign this Agreement without our consent. If any
provision is unenforceable, the rest remains in effect. This Agreement, together with the Privacy Policy, is the entire agreement
between the parties about its subject. Electronic acceptance has the same effect as a signature under the Washington Uniform
Electronic Transactions Act (RCW 1.80) and the federal E-SIGN Act.</p>

<h2>14. Contact</h2>
<p>${c.entity} · ${c.address} · <a href="mailto:${c.email}">${c.email}</a></p>`;
}

function privacyPolicy(c: Company) {
  return `
<p class="lead">This Privacy Policy explains how ${c.entity} ("<b>Bite Wise</b>," "<b>we</b>") collects, uses and shares personal information
when you use the Bite Wise website and services as a customer or restaurant partner.</p>

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
  We use it for that search and do not store it on our servers. You can also search by city or ZIP code instead.</li>
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
  <li><b>For legal reasons:</b> to comply with law, legal process or requests from government authorities (including the Washington
  State Department of Revenue for tax purposes), or to protect the rights, safety and property of users, restaurants or Bite Wise.</li>
  <li><b>Business transfers:</b> in connection with a merger, acquisition or sale of assets, subject to this Policy.</li>
</ul>

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

<h2>8. Children</h2>
<p>The service is not directed to children. You must be at least 18 to create a customer account. We do not knowingly collect personal
information from children under 13; if you believe we have, contact us and we will delete it.</p>

<h2>9. Changes</h2>
<p>We may update this Policy. We will post the new version with a new effective date and, for material changes, notify you and ask you
to review it before continuing to use the service.</p>

<h2>10. Contact</h2>
<p>${c.entity} · ${c.address} · <a href="mailto:${c.email}">${c.email}</a></p>`;
}

export const DOCUMENTS = {
  'customer-terms': { title: 'Customer Terms of Service', render: customerTerms },
  'restaurant-agreement': { title: 'Restaurant Partner Agreement', render: restaurantAgreement },
  privacy: { title: 'Privacy Policy', render: privacyPolicy },
} as const;

export type DocumentId = keyof typeof DOCUMENTS;

// Documents each role must accept.
export const REQUIRED: Record<Exclude<Role, 'admin'>, DocumentId[]> = {
  customer: ['customer-terms', 'privacy'],
  restaurant: ['restaurant-agreement', 'privacy'],
  // Staff work under their restaurant's agreement, accepted by the owner.
  staff: [],
};

export type LegalDocument = { id: DocumentId; title: string; version: string; effective: string; html: string };

export function renderDocument(id: string, company: Company): LegalDocument | null {
  if (!(id in DOCUMENTS)) return null;
  const def = DOCUMENTS[id as DocumentId];
  const c = { ...company, entity: esc(company.entity), email: esc(company.email), address: esc(company.address) };
  return { id: id as DocumentId, title: def.title, version: LEGAL_VERSION, effective: EFFECTIVE, html: def.render(c) };
}

export const requiredDocuments = (role: Exclude<Role, 'admin'>) =>
  REQUIRED[role].map((id) => ({ id, title: DOCUMENTS[id].title, version: LEGAL_VERSION }));

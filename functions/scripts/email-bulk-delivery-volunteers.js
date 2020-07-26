const functions = require('firebase-functions');
const _ = require('lodash');
const sgMail = require('@sendgrid/mail');
const showdown = require('showdown');
const yargs = require('yargs');

sgMail.setApiKey(functions.config().sendgrid.api_key);

const { getAllRoutes, getTicketsForRoutes, getRecordsWithFilter, BULK_DELIVERY_ROUTES_TABLE } = require('../airtable');
const { googleMapsUrl } = require('../messages');

function renderEmail(route, tickets) {
  var email = `
Hi ${route.deliveryVolunteerName[0].split(' ')[0]}!

Thank you for volunteering to deliver groceries to our neighbors with Bed-Stuy Strong!

We've assigned you Route ${route.name} with the following tickets: ${_.join(_.map(tickets, 'ticketID'), ', ')}

### Instructions

This coming Saturday, please come to our warehouse at **[221 Glenmore Ave, Gate 4](${googleMapsUrl('221 Glenmore Ave')}) at ${route.arrivalTime}** to pick up your deliveries. Since there are perishables in the deliveries, you'll need to deliver them immediately after pickup.

You'll load your car with boxes for the above ticket IDs, and then deliver them to the addresses below. You may want to plan your route to Brooklyn Packers and then to the delivery locations in advance.

The neighbors you're delivering to have confirmed their availability for 1:30-4pm, but you'll call each of them before you leave the warehouse, to get any last minute delivery details. 

If possible, we recommend printing this email out so you can mark tickets done as you complete them, to fill out the [Completion Form](https://airtable.com/shrvHf4k5lRo0I8F4) at the end. If any issues come up during your deliveries, or you are unable to deliver any of the boxes (because someone isn't home) contact Jackson at ${functions.config().bulk_ops_team.warehouse_coordinator.phone_number}. We'll help you redistribute the food to the community in another way.

### Checklist
- [ ] Check in with Hanna or Jackson at the warehouse when you arrive. They'll let you know when your boxes are ready. While you're waiting:
- [ ] Call the recipients of each ticket to make sure they're available. If they're not, please let Jackson or Hanna know -- we'll use their items for someone else, and deliver to them another time. 
- [ ] At the warehouse, for each household get some of the following (we'll tell you):
    - [ ] Main food boxes (may be multiple per household)
    - [ ] Cleaning supplies
    - [ ] Custom items
    - [ ] Water
- [ ] Confirm all the ticket IDs match, and have your route number/name on them.
- [ ] Put everything in your car
- [ ] Check off each delivery below as you complete it
- [ ] Fill out the delivery completion form when you're done

----
### Tickets (Route ${route.name})
  `;

  const ticketTexts = tickets.map((ticket) => {
    let details = `\n
#### Ticket ID: ${ticket.ticketID}\n
- [ ] Confirmed someone will be home
- [ ] Delivered!

**Name**: ${ticket.requestName}<br />
**Address**: [${ticket.address}](${googleMapsUrl(ticket.address)})<br />
**Phone Number**: ${ticket.phoneNumber}<br />

**Vulnerabilities**: ${_.join(ticket.vulnerability, ', ')}<br />
**Household Size**: ${ticket.householdSize}<br />

**Grocery List**: ${_.join(ticket.foodOptions, ', ')}<br />
    `;
    if (ticket.otherItems !== null) {
      details += `**Custom Items**: ${ticket.otherItems}<br />`;
    }
    if (ticket.deliveryNotes !== null) {
      details += `\n\n**Notes for Delivery**: ${ticket.deliveryNotes}`;
    }
    return details;
  }).join('\n\n----\n');

  email += ticketTexts;

  const converter = new showdown.Converter({
    tasklists: true,
  });
  const html = converter.makeHtml(email);

  const msg = {
    to: route.deliveryVolunteerEmail,
    cc: 'operations+bulk@bedstuystrong.com',
    replyTo: 'operations+bulk@bedstuystrong.com',
    from: functions.config().sendgrid.from,
    subject: `[BSS Bulk Ordering] July 25th Delivery Prep and Instructions for ${route.deliveryVolunteerName[0].split(' ')[0]}`,
    text: email,
    html: html,
  };

  return msg;
}

async function sendEmail(msg) {
  try {
    const response = await sgMail.send(msg);
    console.log(response);
  } catch (error) {
    console.error(error);

    if (error.response) {
      console.error(error.response.body);
    }
  }
}

async function main() {
  const { argv } = yargs
    .option('deliveryDate', {
      coerce: (x) => new Date(x),
      demandOption: true,
      describe: 'Date of scheduled delivery (yyyy-mm-dd format)',
    })
    .option('route', {
      coerce: String,
      demandOption: false,
      describe: 'Email just one delivery volunteer for a specific route ID',
      type: 'string',
    })
    .boolean('dry-run');
  const routes = argv.route ? (
    await getRecordsWithFilter(BULK_DELIVERY_ROUTES_TABLE, { deliveryDate: argv.deliveryDate, name: argv.route })
  ) : await getAllRoutes(argv.deliveryDate);
  const emails = await Promise.all(_.map(routes, async (route) => {
    const ticketRecords = await getTicketsForRoutes([route]);
    const ticketsFields = _.map(ticketRecords, ([, fields,]) => fields);
    const [, routeFields,] = route;
    return renderEmail(routeFields, ticketsFields);
  }));
  if (argv.dryRun) {
    console.log(emails);
  } else {
    await Promise.all(_.map(emails, sendEmail));
  }
}

main().then(
  () => console.log('done')
).catch(
  (e) => console.error(e)
);

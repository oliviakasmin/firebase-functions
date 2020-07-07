const functions = require('firebase-functions')
const _ = require('lodash')
const sgMail = require('@sendgrid/mail');
const showdown  = require('showdown')

sgMail.setApiKey(functions.config().sendgrid.api_key);

const { INTAKE_TABLE, VOLUNTEER_FORM_TABLE, getRecord, getRecordsWithStatus } = require('../airtable')

async function getBulkDeliveryConfirmedTickets() {
  return await getRecordsWithStatus(INTAKE_TABLE, 'Bulk Delivery Confirmed')
}

function clusterTickets(tickets) {
  return _.groupBy(tickets, ([, fields,]) => {
    if (fields['Bulk Cluster'].length !== 1) {
      throw new Error(`Ticket ${fields} does not have one Bulk Cluster`)
    }
    return fields['Bulk Cluster'][0]
  })
}

async function getDeliveryVolunteerInfo(cluster, tickets) {
  const volunteerIds = _.union(
    _.flatMap(tickets, ([, fields,]) => {
      if (!fields.deliveryVolunteer || fields.deliveryVolunteer.length !== 1) {
        throw new Error(`Ticket ${fields.ticketID} doesn't have exactly one volunteer: ${fields.deliveryVolunteer}`)
      }
      return fields.deliveryVolunteer
    })
  )
  if (volunteerIds.length !== 1) {
    throw new Error(`Cluster ${cluster} doesn't have exactly one delivery volunteer: ${volunteerIds}`)
  }
  return await getRecord(VOLUNTEER_FORM_TABLE, volunteerIds[0])
}

function renderEmail({ cluster, volunteer }) {
  var email = `
  Thank you for volunteering to deliver groceries to our neighbors!

  We've assigned you the following tickets: ${_.join(_.map(cluster, 'ticketID'), ', ')}

  This coming Saturday, please come to Brooklyn Packers TODO(address) between 1pm and 3pm to pick up boxes.

  You'll load your car with boxes for the above ticket IDs, and then deliver them to the addresses below. You may want to plan your route to Brooklyn Packers and then to the delivery locations in advance.

  The people you're delivering to have already confirmed they'll be available from 1pm to 5pm, but you may want to call them on Saturday morning to get any last details like how to contact them when you arrive.

  We recommend printing this email out so you can mark tickets done as you complete them, to fill out the [Completion Form](https://airtable.com/shrvHf4k5lRo0I8F4) at the end. If you cannot complete any of your deliveries, contact us TODO and we'll take the groceries back and donate them elsewhere.
  `
  for (const ticket of cluster) {
    email += `\n**Ticket ID**: ${ticket.ticketID}<br/>`
    email += `**Name**: ${ticket.requestName}<br/>`
    email += `**Address**: ${ticket.address}<br/>`
    email += `**Phone Number**: ${ticket.phoneNumber}<br/>`
    email += `**Vulnerabilities**: ${_.join(ticket.vulnerability, ', ')}<br/>`
    email += `**Household Size**: ${ticket.householdSize}\n`
  }

  const converter = new showdown.Converter()
  const html = converter.makeHtml(email);

  const msg = {
    to: 'leif.walsh@gmail.com', // TODO: replace with volunteer.email
    from: functions.config().sendgrid.from,
    subject: 'Bulk Delivery Prep and Instructions',
    text: email,
    html: html,
  };

  return msg
}

async function sendEmail(msg) {
  try {
    await sgMail.send(msg);
  } catch (error) {
    console.error(error);

    if (error.response) {
      console.error(error.response.body)
    }
  }
}

async function main() {
  const bulkTickets = await getBulkDeliveryConfirmedTickets()
  const clusters = clusterTickets(bulkTickets)
  const assignedClusters = await Promise.all(_.map(_.entries(clusters), async ([clusterId, cluster]) => (
    { cluster: _.map(cluster, ([, fields,]) => fields), volunteer: (await getDeliveryVolunteerInfo(clusterId, cluster))[1] }
  )))
  const emails = _.map(assignedClusters, renderEmail)
  await Promise.all(_.map(emails, sendEmail))
}

main().then(
  () => console.log('done')
).catch(
  (e) => console.error(e)
)
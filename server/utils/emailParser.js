/**
 * Parse email in format: firstname.lastname.student.school@engelska.se
 * Extract first name, last name, and school identifier
 */
function parseEmail(email) {
  const allowedDomain = process.env.ALLOWED_EMAIL_DOMAIN || 'engelska.se';

  // Validate email format
  const emailRegex = new RegExp(`^([a-z]+)\\.([a-z]+)\\.student\\.([a-z]+)@${allowedDomain}$`, 'i');
  const match = email.toLowerCase().match(emailRegex);

  if (!match) {
    return null;
  }

  return {
    firstName: capitalizeFirst(match[1]),
    lastName: capitalizeFirst(match[2]),
    schoolIdentifier: match[3],
    isValid: true
  };
}

function capitalizeFirst(str) {
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

function validateEmailDomain(email) {
  const allowedDomain = process.env.ALLOWED_EMAIL_DOMAIN || 'engelska.se';
  return email.toLowerCase().endsWith(`@${allowedDomain}`);
}

module.exports = {
  parseEmail,
  validateEmailDomain
};

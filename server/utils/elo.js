/**
 * ELO Rating System
 * Standard implementation with K-factor of 32 for junior players
 */

const K_FACTOR = 32;

/**
 * Calculate expected score for player A
 * @param {number} ratingA - Player A's current rating
 * @param {number} ratingB - Player B's current rating
 * @returns {number} Expected score (0-1)
 */
function getExpectedScore(ratingA, ratingB) {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

/**
 * Calculate new ELO ratings after a game
 * @param {number} whiteRating - White player's current rating
 * @param {number} blackRating - Black player's current rating
 * @param {string} result - Game result: 'white_win', 'black_win', or 'draw'
 * @returns {Object} New ratings for both players
 */
function calculateNewRatings(whiteRating, blackRating, result) {
  const expectedWhite = getExpectedScore(whiteRating, blackRating);
  const expectedBlack = 1 - expectedWhite;

  let actualWhite, actualBlack;

  switch (result) {
    case 'white_win':
      actualWhite = 1;
      actualBlack = 0;
      break;
    case 'black_win':
      actualWhite = 0;
      actualBlack = 1;
      break;
    case 'draw':
      actualWhite = 0.5;
      actualBlack = 0.5;
      break;
    default:
      throw new Error('Invalid game result');
  }

  const whiteChange = Math.round(K_FACTOR * (actualWhite - expectedWhite));
  const blackChange = Math.round(K_FACTOR * (actualBlack - expectedBlack));

  return {
    whiteRating: whiteRating + whiteChange,
    blackRating: blackRating + blackChange,
    whiteChange,
    blackChange
  };
}

/**
 * Calculate tiebreak score (Sonneborn-Berger system)
 * Sum of: (opponent's score × result against opponent)
 * @param {Array} games - Array of game results with opponent scores
 * @returns {number} Tiebreak score
 */
function calculateTiebreak(games) {
  return games.reduce((total, game) => {
    const opponentScore = game.opponentTotalScore || 0;
    const result = game.result; // 1, 0.5, or 0
    return total + (opponentScore * result);
  }, 0);
}

module.exports = {
  calculateNewRatings,
  calculateTiebreak,
  getExpectedScore
};

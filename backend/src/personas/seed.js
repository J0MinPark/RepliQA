const { collections } = require('../db/firestore');
const { PERSONAS } = require('./definitions');

async function seed() {
  for (const persona of PERSONAS) {
    const { id, ...data } = persona;
    // eslint-disable-next-line no-await-in-loop
    await collections.personas().doc(id).set(data, { merge: true });
    console.log(`✔ persona seeded: ${id}`);
  }
  console.log('완료.');
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});

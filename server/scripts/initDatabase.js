/**
 * Database Initialization Script
 * Creates the database schema and optionally seeds with test data
 */

require('dotenv').config();
const { db, initializeDatabase } = require('../config/database');
const bcrypt = require('bcrypt');

async function createTestData() {
  console.log('\n--- Creating Test Data ---\n');

  // Create test schools
  const schools = [
    { name: 'stockholm', email_identifier: 'stockholm' },
    { name: 'goteborg', email_identifier: 'goteborg' },
    { name: 'malmo', email_identifier: 'malmo' }
  ];

  for (const school of schools) {
    await new Promise((resolve, reject) => {
      db.run(
        'INSERT OR IGNORE INTO schools (name, email_identifier) VALUES (?, ?)',
        [school.name, school.email_identifier],
        (err) => {
          if (err) reject(err);
          else {
            console.log(`✓ Created school: ${school.name}`);
            resolve();
          }
        }
      );
    });
  }

  // Create super admin
  const adminPassword = await bcrypt.hash('admin123', 10);

  await new Promise((resolve, reject) => {
    db.run(
      `INSERT OR IGNORE INTO users (email, password_hash, first_name, last_name, school_id, year_group, role, is_verified)
       VALUES (?, ?, ?, ?, 1, 9, 'super_admin', 1)`,
      ['admin.super.student.stockholm@engelska.se', adminPassword, 'Admin', 'Super'],
      (err) => {
        if (err) reject(err);
        else {
          console.log('✓ Created super admin: admin.super.student.stockholm@engelska.se (password: admin123)');
          resolve();
        }
      }
    );
  });

  // Create test students
  const testStudents = [
    { email: 'john.doe.student.stockholm@engelska.se', firstName: 'John', lastName: 'Doe', yearGroup: 7, schoolId: 1, elo: 1300 },
    { email: 'jane.smith.student.stockholm@engelska.se', firstName: 'Jane', lastName: 'Smith', yearGroup: 7, schoolId: 1, elo: 1250 },
    { email: 'erik.larsson.student.goteborg@engelska.se', firstName: 'Erik', lastName: 'Larsson', yearGroup: 8, schoolId: 2, elo: 1400 },
    { email: 'anna.andersson.student.malmo@engelska.se', firstName: 'Anna', lastName: 'Andersson', yearGroup: 6, schoolId: 3, elo: 1200 }
  ];

  const studentPassword = await bcrypt.hash('student123', 10);

  for (const student of testStudents) {
    await new Promise((resolve, reject) => {
      db.run(
        `INSERT OR IGNORE INTO users (email, password_hash, first_name, last_name, school_id, year_group, role, elo_rating, is_verified)
         VALUES (?, ?, ?, ?, ?, ?, 'student', ?, 1)`,
        [student.email, studentPassword, student.firstName, student.lastName, student.schoolId, student.yearGroup, student.elo],
        (err) => {
          if (err) reject(err);
          else {
            console.log(`✓ Created student: ${student.email} (password: student123)`);
            resolve();
          }
        }
      );
    });
  }

  console.log('\n--- Test Data Created Successfully ---\n');
  console.log('Login credentials:');
  console.log('  Super Admin: admin.super.student.stockholm@engelska.se / admin123');
  console.log('  Students: john.doe.student.stockholm@engelska.se / student123 (and others)');
  console.log('');
}

async function initialize() {
  try {
    console.log('=================================');
    console.log('Chess Tournament Portal');
    console.log('Database Initialization');
    console.log('=================================\n');

    // Initialize database schema
    await initializeDatabase();

    // Ask if user wants test data
    const args = process.argv.slice(2);
    const withTestData = args.includes('--with-test-data');

    if (withTestData) {
      await createTestData();
    } else {
      console.log('\nDatabase schema created successfully!');
      console.log('\nTo add test data, run:');
      console.log('  npm run init-db -- --with-test-data\n');
    }

    console.log('=================================');
    console.log('Initialization Complete!');
    console.log('=================================\n');

    db.close();
  } catch (error) {
    console.error('Error initializing database:', error);
    process.exit(1);
  }
}

initialize();

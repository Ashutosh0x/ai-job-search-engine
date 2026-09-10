// Test profile completion calculation
const testProfileCompletion = () => {
  // Mock profile data similar to what's in the database
  const profile = {
    name: "Ashutosh Kumar Singh",
    title: "Software Engineer",
    company: "Tech Company",
    bio: "Passionate developer",
    experience: "5 years",
    education: "B.Tech Computer Science",
    skills: ["JavaScript", "React", "Node.js"],
    location: "India",
    phone: "9876543210",
    github_url: "https://github.com/ashutosh0x",
    linkedin_url: "https://www.linkedin.com/in/ashutoshkumar-singh951/",
    twitter_url: "https://x.com/0xAshutosh",
    website: "https://cloud.ashutoshdev.me",
    social_links: {}
  }

  // Calculate completion
  let completion = 0
  if (profile.name && profile.name.trim() !== '' && profile.name !== 'Updated Name') completion += 10
  if (profile.title && profile.title.trim() !== '') completion += 15
  if (profile.company && profile.company.trim() !== '') completion += 10
  if (profile.bio && profile.bio.trim() !== '') completion += 15
  if (profile.experience && profile.experience.trim() !== '') completion += 10
  if (profile.education && profile.education.trim() !== '') completion += 10
  if (profile.skills && profile.skills.length > 0) completion += 10
  if (profile.location && profile.location.trim() !== '') completion += 10
  if (profile.phone && profile.phone.trim() !== '') completion += 5
  if (profile.social_links && Object.keys(profile.social_links).length > 0) completion += 5
  if (profile.github_url && profile.github_url.trim() !== '') completion += 5
  if (profile.linkedin_url && profile.linkedin_url.trim() !== '') completion += 5
  if (profile.twitter_url && profile.twitter_url.trim() !== '') completion += 5
  if (profile.website && profile.website.trim() !== '') completion += 5

  console.log('Profile data:', profile)
  console.log('Calculated completion:', completion + '%')
  
  // Breakdown
  console.log('\nBreakdown:')
  console.log('Name:', profile.name ? '✓ (10%)' : '✗')
  console.log('Title:', profile.title ? '✓ (15%)' : '✗')
  console.log('Company:', profile.company ? '✓ (10%)' : '✗')
  console.log('Bio:', profile.bio ? '✓ (15%)' : '✗')
  console.log('Experience:', profile.experience ? '✓ (10%)' : '✗')
  console.log('Education:', profile.education ? '✓ (10%)' : '✗')
  console.log('Skills:', profile.skills.length > 0 ? '✓ (10%)' : '✗')
  console.log('Location:', profile.location ? '✓ (10%)' : '✗')
  console.log('Phone:', profile.phone ? '✓ (5%)' : '✗')
  console.log('GitHub:', profile.github_url ? '✓ (5%)' : '✗')
  console.log('LinkedIn:', profile.linkedin_url ? '✓ (5%)' : '✗')
  console.log('Twitter:', profile.twitter_url ? '✓ (5%)' : '✗')
  console.log('Website:', profile.website ? '✓ (5%)' : '✗')
}

testProfileCompletion()

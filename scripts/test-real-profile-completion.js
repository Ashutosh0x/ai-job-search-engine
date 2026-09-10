// Test profile completion calculation with real data from audit logs
const testRealProfileCompletion = () => {
  // Real profile data from audit logs
  const profile = {
    name: "Updated Name", // This should be fixed
    title: "",
    company: "",
    bio: "",
    experience: "",
    education: "",
    skills: ["java", "javascript", "SQL"],
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

  console.log('Real Profile data:', profile)
  console.log('Calculated completion:', completion + '%')
  
  // Breakdown
  console.log('\nBreakdown:')
  console.log('Name:', profile.name && profile.name !== 'Updated Name' ? '✓ (10%)' : '✗')
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

  // Test with fixed name
  const profileWithFixedName = {
    ...profile,
    name: "ashutosh" // Using email username
  }

  let completionFixed = 0
  if (profileWithFixedName.name && profileWithFixedName.name.trim() !== '' && profileWithFixedName.name !== 'Updated Name') completionFixed += 10
  if (profileWithFixedName.title && profileWithFixedName.title.trim() !== '') completionFixed += 15
  if (profileWithFixedName.company && profileWithFixedName.company.trim() !== '') completionFixed += 10
  if (profileWithFixedName.bio && profileWithFixedName.bio.trim() !== '') completionFixed += 15
  if (profileWithFixedName.experience && profileWithFixedName.experience.trim() !== '') completionFixed += 10
  if (profileWithFixedName.education && profileWithFixedName.education.trim() !== '') completionFixed += 10
  if (profileWithFixedName.skills && profileWithFixedName.skills.length > 0) completionFixed += 10
  if (profileWithFixedName.location && profileWithFixedName.location.trim() !== '') completionFixed += 10
  if (profileWithFixedName.phone && profileWithFixedName.phone.trim() !== '') completionFixed += 5
  if (profileWithFixedName.social_links && Object.keys(profileWithFixedName.social_links).length > 0) completionFixed += 5
  if (profileWithFixedName.github_url && profileWithFixedName.github_url.trim() !== '') completionFixed += 5
  if (profileWithFixedName.linkedin_url && profileWithFixedName.linkedin_url.trim() !== '') completionFixed += 5
  if (profileWithFixedName.twitter_url && profileWithFixedName.twitter_url.trim() !== '') completionFixed += 5
  if (profileWithFixedName.website && profileWithFixedName.website.trim() !== '') completionFixed += 5

  console.log('\nWith fixed name:', profileWithFixedName.name)
  console.log('Fixed completion:', completionFixed + '%')
}

testRealProfileCompletion()

"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { ArrowLeft, ArrowRight, Search, Heart, X, CheckCircle, XCircle, Menu } from "lucide-react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { useRouter } from "next/navigation"
import { useToast } from "@/components/toast-provider"
import { getSupabaseClient } from "@/lib/supabase"

interface PreferencesData {
  roleTypes: string[]
  specializations: { [key: string]: string[] }
  workLocation: string
  locations: string[]
  roleLevel: string[]
  leadershipRole: string
  companySize: string[]
  preferredIndustries: string[]
  avoidIndustries: string[]
  skills: string[]
  favoriteSkills: string[]
  avoidSkills: string[]
  minimumSalary: number
  securityClearance: string
  jobSearchStatus: string
}

export default function PreferencesOnboarding() {
  const toast = useToast()
  const router = useRouter()
  const [currentStep, setCurrentStep] = useState(0)
  const [searchTerm, setSearchTerm] = useState("")
  const [sidebarOpen, setSidebarOpen] = useState(false)
  // State to track if the welcome toast has been shown
  const [welcomeToastShown, setWelcomeToastShown] = useState(false)

  const [preferences, setPreferences] = useState<PreferencesData>({
    roleTypes: [],
    specializations: {},
    workLocation: "",
    locations: [],
    roleLevel: [],
    leadershipRole: "",
    companySize: [],
    preferredIndustries: [],
    avoidIndustries: [],
    skills: [],
    favoriteSkills: [],
    avoidSkills: [],
    minimumSalary: 18000,
    securityClearance: "",
    jobSearchStatus: "",
  })

  const supabase = getSupabaseClient();
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [fullName, setFullName] = useState<string | null>(null)

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return
        const { data } = await supabase
          .from('profiles')
          .select('full_name, avatar_url')
          .eq('id', user.id)
          .single()
        if (data?.full_name) setFullName(data.full_name as string)
        if (data?.avatar_url) {
          let url: string = data.avatar_url as string
          try {
            if (!url.includes('http') && url.includes('avatars/')) {
              const { data: signed } = await supabase.storage.from('resume').createSignedUrl(url, 3600)
              url = signed?.signedUrl || url
            }
          } catch {}
          setAvatarUrl(url)
        }
      } catch {}
    }
    fetchProfile()
  }, [supabase])

  // Display welcome toast only once when the component mounts
  useEffect(() => {
    // Check if the welcome toast has not been shown yet
    if (!welcomeToastShown) {
      toast.addToast({
        title: "Welcome!",
        description: "Let's set up your job preferences to get started.",
        duration: 10000,
      })
      // Set the flag to true so the toast doesn't show again
      setWelcomeToastShown(true)
    }
  }, [welcomeToastShown, toast]) // Added toast to dependency array as it's from a hook

  const steps = [
    { id: "role-type", title: "Role Type", progress: 20 },
    { id: "location", title: "Location", progress: 30 },
    { id: "role-level", title: "Role Level", progress: 40 },
    { id: "company-size", title: "Company Size", progress: 50 },
    { id: "industries", title: "Industries", progress: 60 },
    { id: "skills", title: "Skills", progress: 70 },
    { id: "salary", title: "Minimum Salary", progress: 80 },
    { id: "security", title: "Security Clearance", progress: 90 },
    { id: "status", title: "Job Search Status", progress: 100 },
  ]

  const roleTypes = {
    "Technical & Engineering": [
      "Aerospace Engineering",
      "AI & Machine Learning",
      "Architecture & Civil Engineering",
      "Data & Analytics",
      "Developer Relations",
      "DevOps & Infrastructure",
      "Electrical Engineering",
      "Engineering Management",
      "Hardware Engineering",
      "IT & Security",
      "Mechanical Engineering",
      "Process Engineering",
      "QA & Testing",
      "Quantitative Finance",
      "Quantum Computing",
      "Sales & Solution Engineering",
      "Software Engineering",
    ],
    "Finance & Operations & Strategy": [
      "Accounting",
      "Business & Strategy",
      "Consulting",
      "Finance & Banking",
      "Growth & Marketing",
      "Operations & Logistics",
      "Product",
      "Real Estate",
      "Retail",
      "Sales & Account Management",
    ],
    "Creative & Design": [
      "Art, Graphics & Animation",
      "Audio & Sound Design",
      "Content & Writing",
      "Creative Production",
      "Journalism",
      "Social Media",
      "UI/UX & Design",
    ],
    "Education & Training": ["Education", "Training"],
    "Legal & Support & Administration": [
      "Administrative & Executive Assistance",
      "Clerical & Data Entry",
      "Customer Experience & Support",
      "Legal & Compliance",
      "People & HR",
      "Security & Protective Services",
    ],
    "Life Sciences": ["Biology & Biotech", "Lab & Research", "Medical, Clinical & Veterinary"],
  }

  const specializations = {
    "AI & Machine Learning": [
      "AI Research",
      "Applied Machine Learning",
      "Computer Vision",
      "Conversational AI & Chatbots",
      "Deep Learning",
      "Natural Language Processing (NLP)",
      "Robotics & Autonomous Systems",
      "Speech Recognition",
    ],
    "DevOps & Infrastructure": [
      "Cloud Analyst",
      "Cloud Engineering",
      "Database Administration",
      "DevOps Engineering",
      "Financial Operations",
      "Network Engineering",
      "Platform Engineering",
      "Server Administration",
      "Site Reliability Engineering",
    ],
    "Software Engineering": [
      "Android Development",
      "Backend Engineering",
      "Embedded Engineering",
      "FinTech Engineering",
      "Frontend Engineering",
      "Full-Stack Engineering",
      "Game Engineering",
      "iOS Development",
      "IT & Support",
      "Mobile Engineering",
      "Security Engineering",
      "Software QA & Testing",
      "Web Development",
    ],
    "IT & Security": [
      "Cybersecurity",
      "IT Project Management",
      "IT Support",
      "Network Administration",
      "System Administration",
    ],
  }

  const countries = {
    "United States": [
      "Atlanta",
      "Austin",
      "Baltimore",
      "Boston",
      "Charlotte",
      "Chicago",
      "Dallas",
      "Denver",
      "Las Vegas",
      "Los Angeles",
      "Miami",
      "New York City",
      "Philadelphia",
      "Phoenix",
      "Portland",
      "Remote in USA",
      "San Diego",
      "San Francisco Bay Area",
      "Seattle",
      "Washington D.C.",
    ],
    Canada: ["Montreal", "Ottawa", "Quebec City", "Remote in Canada", "Toronto", "Vancouver", "Winnipeg"],
    "United Kingdom": ["Birmingham", "Liverpool", "London", "Manchester", "Remote in UK"],
    Australia: ["Melbourne", "Remote in Australia", "Sydney"],
    France: ["Paris", "Remote in France"],
    Germany: ["Berlin", "Frankfurt", "Munich", "Remote in Germany"],
    India: ["Bengaluru", "Chennai", "Delhi", "Hyderabad", "Kolkata", "Mumbai", "Remote in India"],
  }

  const industries = [
    "Aerospace",
    "AI & Machine Learning",
    "Automotive & Transportation",
    "Biotechnology",
    "Consulting",
    "Consumer Goods",
    "Consumer Software",
    "Crypto & Web3",
    "Cybersecurity",
    "Data & Analytics",
    "Defense",
    "Design",
    "Education",
    "Energy",
    "Enterprise Software",
    "Entertainment",
    "Financial Services",
    "Fintech",
    "Food & Agriculture",
    "Gaming",
    "Government & Public Sector",
    "Hardware",
    "Healthcare",
    "Industrial & Manufacturing",
    "Legal",
    "Quantitative Finance",
    "Real Estate",
    "Robotics & Automation",
    "Social Impact",
    "Venture Capital",
    "VR & AR",
  ]

  const allSkills = [
    "Adobe Illustrator",
    "Business Analytics",
    "Excel/Numbers/Sheets",
    "HTML/CSS",
    "MailChimp",
    "MATLAB",
    "Operations Research",
    "SEO",
    "Zendesk",
    "Git",
    "Java",
    "Python",
    "Kotlin",
    "React.js",
    "Node.js",
    "Django",
    "MySQL",
    "MongoDB",
    "Elasticsearch",
    "Tensorflow",
    "AWS",
    "CloudFormation",
    "Jenkins",
    "Terraform",
    "Kubernetes",
    "Docker",
    "Google Cloud Platform",
    "golang",
    "Linux/Unix",
    "Apache Kafka",
    "LLM",
    "cloud security",
    "SQL",
    "PostgreSQL",
    "lambda",
    "Redis",
  ]

  const handleNext = async () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1)
    } else {
      // Save preferences to localStorage
      localStorage.setItem("userPreferences", JSON.stringify(preferences))
      // Save preferences to Supabase
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { error } = await supabase
            .from("profiles")
            .update({ preferences })
            .eq("id", user.id);
          if (error) {
            toast.addToast({
              title: "Error",
              description: "Failed to save preferences to your profile.",
              duration: 8000,
            });
          } else {
            toast.addToast({
              title: "Preferences Saved!",
              description: "Your job preferences have been saved to your profile.",
              duration: 8000,
            });
          }
        }
      } catch (err) {
        toast.addToast({
          title: "Error",
          description: "An unexpected error occurred while saving preferences.",
          duration: 8000,
        });
      }
      router.push("/dashboard")
    }
  }

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1)
    }
  }

  const toggleSelection = (category: keyof PreferencesData, value: string) => {
    setPreferences((prev) => {
      const current = prev[category] as string[]
      const updated = current.includes(value) ? current.filter((item) => item !== value) : [...current, value]
      return { ...prev, [category]: updated }
    })
  }

  const toggleSpecialization = (roleType: string, specialization: string) => {
    setPreferences((prev) => ({
      ...prev,
      specializations: {
        ...prev.specializations,
        [roleType]: prev.specializations[roleType]?.includes(specialization)
          ? prev.specializations[roleType].filter((s) => s !== specialization)
          : [...(prev.specializations[roleType] || []), specialization],
      },
    }))
  }

  const renderRoleTypeStep = () => (
    <div className="space-y-6 sm:space-y-8">
      <div className="text-center">
        <h2 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white mb-2">
          What kinds of roles are you interested in?
        </h2>
        <p className="text-gray-600 dark:text-gray-400">Select up to 5</p>
      </div>

      {Object.entries(roleTypes).map(([category, roles]) => (
        <div key={category} className="space-y-4">
          <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white">{category}</h3>
          <div className="flex flex-wrap gap-2">
            {roles.map((role) => (
              <Button
                key={role}
                variant={preferences.roleTypes.includes(role) ? "default" : "outline"}
                onClick={() => toggleSelection("roleTypes", role)}
                className={`rounded-full text-xs sm:text-sm ${
                  preferences.roleTypes.includes(role)
                    ? "bg-purple-600 hover:bg-purple-700 text-white"
                    : "border-gray-300 hover:border-purple-300"
                }`}
                disabled={!preferences.roleTypes.includes(role) && preferences.roleTypes.length >= 5}
              >
                {role}
              </Button>
            ))}
          </div>
        </div>
      ))}

      {/* Specializations */}
      {preferences.roleTypes.some((role) => specializations[role as keyof typeof specializations]) && (
        <div className="space-y-6 pt-6 sm:pt-8 border-t border-gray-200 dark:border-gray-700">
          <div className="text-center">
            <p className="text-gray-600 dark:text-gray-400 text-sm sm:text-base">
              Choose specializations to refine your preferences! We'll show you job matches to your specializations
              first.
            </p>
          </div>

          {preferences.roleTypes.map((roleType) => {
            const specs = specializations[roleType as keyof typeof specializations]
            if (!specs) return null

            return (
              <div key={roleType} className="space-y-4">
                <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white">
                  {roleType}
                  <span className="text-sm font-normal text-gray-500 block">
                    (Select the most relevant specializations for you)
                  </span>
                </h3>
                <div className="flex flex-wrap gap-2">
                  {specs.map((spec) => (
                    <Button
                      key={spec}
                      variant={preferences.specializations[roleType]?.includes(spec) ? "default" : "outline"}
                      onClick={() => toggleSpecialization(roleType, spec)}
                      className={`rounded-full text-xs sm:text-sm ${
                        preferences.specializations[roleType]?.includes(spec)
                          ? "bg-purple-600 hover:bg-purple-700 text-white"
                          : "border-gray-300 hover:border-purple-300"
                      }`}
                    >
                      {spec}
                    </Button>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )

  const renderLocationStep = () => (
    <div className="space-y-6 sm:space-y-8">
      <div className="text-center">
        <h2 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white mb-6">
          Where would you like to work?
        </h2>
      </div>

      <div className="space-y-6">
        <div>
          <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white mb-4">
            Work Location Preferences
          </h3>
          <p className="text-gray-600 dark:text-gray-400 mb-4 text-sm sm:text-base">How do you prefer to work?</p>
          <div className="flex flex-wrap gap-2 sm:gap-4">
            {["In-Person", "Hybrid", "Remote"].map((type) => (
              <Button
                key={type}
                variant={preferences.workLocation === type ? "default" : "outline"}
                onClick={() => setPreferences((prev) => ({ ...prev, workLocation: type }))}
                className={`rounded-full text-sm sm:text-base ${
                  preferences.workLocation === type
                    ? "bg-purple-600 hover:bg-purple-700 text-white"
                    : "border-gray-300 hover:border-purple-300"
                }`}
              >
                {type}
              </Button>
            ))}
          </div>
        </div>

        {Object.entries(countries).map(([country, cities]) => (
          <div key={country} className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white">{country}</h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  const allSelected = cities.every((city) => preferences.locations.includes(city))
                  if (allSelected) {
                    setPreferences((prev) => ({
                      ...prev,
                      locations: prev.locations.filter((loc) => !cities.includes(loc)),
                    }))
                  } else {
                    setPreferences((prev) => ({
                      ...prev,
                      locations: [...new Set([...prev.locations, ...cities])],
                    }))
                  }
                }}
                className="text-purple-600 hover:text-purple-700 text-sm"
              >
                Select all in {country}
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {cities.map((city) => (
                <Button
                  key={city}
                  variant={preferences.locations.includes(city) ? "default" : "outline"}
                  onClick={() => toggleSelection("locations", city)}
                  className={`rounded-full text-xs sm:text-sm ${
                    preferences.locations.includes(city)
                      ? "bg-purple-600 hover:bg-purple-700 text-white"
                      : "border-gray-300 hover:border-purple-300"
                  }`}
                >
                  {city}
                </Button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )

  const renderRoleLevelStep = () => (
    <div className="space-y-6 sm:space-y-8">
      <div className="text-center">
        <h2 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white mb-6">
          What type of roles are you looking for?
        </h2>
      </div>

      <div className="space-y-6">
        <div className="flex flex-wrap gap-2">
          {["Internship", "Full-Time", "Part-Time", "Contract"].map((type) => (
            <Button
              key={type}
              variant={preferences.roleLevel.includes(type) ? "default" : "outline"}
              onClick={() => toggleSelection("roleLevel", type)}
              className={`rounded-full text-sm ${
                preferences.roleLevel.includes(type)
                  ? "bg-purple-600 hover:bg-purple-700 text-white"
                  : "border-gray-300 hover:border-purple-300"
              }`}
            >
              {type}
            </Button>
          ))}
        </div>

        <div>
          <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white mb-4">
            What level of roles are you looking for?
          </h3>
          <p className="text-gray-600 dark:text-gray-400 mb-4 text-sm sm:text-base">Select up to 2</p>
          <div className="flex flex-wrap gap-2">
            {[
              "Entry Level & New Grad",
              "Junior (1 to 2 years)",
              "Mid-level (3 to 4 years)",
              "Senior (5 to 8 years)",
              "Expert & Leadership (9+ years)",
            ].map((level) => (
              <Button
                key={level}
                variant={preferences.roleLevel.includes(level) ? "default" : "outline"}
                onClick={() => toggleSelection("roleLevel", level)}
                className={`rounded-full text-xs sm:text-sm ${
                  preferences.roleLevel.includes(level)
                    ? "bg-purple-600 hover:bg-purple-700 text-white"
                    : "border-gray-300 hover:border-purple-300"
                }`}
                disabled={!preferences.roleLevel.includes(level) && preferences.roleLevel.length >= 2}
              >
                {level}
              </Button>
            ))}
          </div>
        </div>

        <div>
          <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white mb-4">
            Are you looking for a specific leadership role?
          </h3>
          <div className="flex flex-wrap gap-2 sm:gap-4">
            {["Individual Contributor", "Manager", "I don't have a preference"].map((role) => (
              <Button
                key={role}
                variant={preferences.leadershipRole === role ? "default" : "outline"}
                onClick={() => setPreferences((prev) => ({ ...prev, leadershipRole: role }))}
                className={`rounded-full text-xs sm:text-sm ${
                  preferences.leadershipRole === role
                    ? "bg-purple-600 hover:bg-purple-700 text-white"
                    : "border-gray-300 hover:border-purple-300"
                }`}
              >
                {role}
              </Button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )

  const renderCompanySizeStep = () => (
    <div className="space-y-6 sm:space-y-8">
      <div className="text-center">
        <h2 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white mb-2">
          What is your ideal company size?
        </h2>
        <p className="text-gray-600 dark:text-gray-400 text-sm sm:text-base">Select all sizes</p>
      </div>

      <div className="flex flex-wrap gap-2 justify-center">
        {[
          "1-10 employees",
          "11-50 employees",
          "51-200 employees",
          "201-500 employees",
          "501-1,000 employees",
          "1,001-5,000 employees",
          "5,001-10,000 employees",
          "10,001+ employees",
        ].map((size) => (
          <Button
            key={size}
            variant={preferences.companySize.includes(size) ? "default" : "outline"}
            onClick={() => toggleSelection("companySize", size)}
            className={`rounded-full text-xs sm:text-sm ${
              preferences.companySize.includes(size)
                ? "bg-purple-600 hover:bg-purple-700 text-white"
                : "border-gray-300 hover:border-purple-300"
            }`}
          >
            {size}
          </Button>
        ))}
      </div>
    </div>
  )

  const renderIndustriesStep = () => (
    <div className="space-y-6 sm:space-y-8">
      <div className="text-center">
        <h2 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white mb-6">
          What industries are exciting to you?
        </h2>
      </div>

      <div className="space-y-8">
        <div>
          <div className="flex items-center space-x-2 mb-4">
            <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0" />
            <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white">
              First, what industries are exciting to you?
            </h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {industries.map((industry) => (
              <Button
                key={industry}
                variant={preferences.preferredIndustries.includes(industry) ? "default" : "outline"}
                onClick={() => toggleSelection("preferredIndustries", industry)}
                className={`rounded-full text-xs sm:text-sm ${
                  preferences.preferredIndustries.includes(industry)
                    ? "bg-teal-500 hover:bg-teal-600 text-white"
                    : "border-gray-300 hover:border-teal-300"
                }`}
              >
                {industry}
              </Button>
            ))}
          </div>
        </div>

        <div>
          <div className="flex items-center space-x-2 mb-4">
            <XCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
            <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white">
              Second, are there any industries you don't want to work in?
            </h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {industries
              .filter((industry) => !preferences.preferredIndustries.includes(industry))
              .map((industry) => (
                <Button
                  key={industry}
                  variant={preferences.avoidIndustries.includes(industry) ? "default" : "outline"}
                  onClick={() => toggleSelection("avoidIndustries", industry)}
                  className={`rounded-full text-xs sm:text-sm ${
                    preferences.avoidIndustries.includes(industry)
                      ? "bg-red-500 hover:bg-red-600 text-white"
                      : "border-gray-300 hover:border-red-300"
                  }`}
                >
                  {industry}
                </Button>
              ))}
          </div>
        </div>
      </div>
    </div>
  )

  const renderSkillsStep = () => {
    const filteredSkills = allSkills.filter((skill) => skill.toLowerCase().includes(searchTerm.toLowerCase()))

    return (
      <div className="space-y-6 sm:space-y-8">
        <div className="text-center">
          <h2 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white mb-2">
            What skills do you have or enjoy working with?
          </h2>
          <p className="text-gray-600 dark:text-gray-400 text-sm sm:text-base">Select all that applies</p>
          <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 mt-2">
            <Heart className="w-4 h-4 inline mr-1" />
            Heart a skill indicate that you'd prefer roles that utilize that skill!
          </p>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <Input
            placeholder="Search all skills..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>

        <div className="space-y-6">
          <div>
            <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white mb-4">Selected skills</h3>
            <div className="flex flex-wrap gap-2">
              {preferences.skills.map((skill) => (
                <div key={skill} className="flex items-center space-x-1">
                  <Badge className="bg-purple-600 text-white text-xs sm:text-sm">
                    {skill}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleSelection("skills", skill)}
                      className="ml-1 h-4 w-4 p-0 hover:bg-purple-700"
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  </Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setPreferences((prev) => ({
                        ...prev,
                        favoriteSkills: prev.favoriteSkills.includes(skill)
                          ? prev.favoriteSkills.filter((s) => s !== skill)
                          : [...prev.favoriteSkills, skill],
                      }))
                    }}
                    className="p-1"
                  >
                    <Heart
                      className={`w-4 h-4 ${
                        preferences.favoriteSkills.includes(skill) ? "fill-red-500 text-red-500" : "text-gray-400"
                      }`}
                    />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {filteredSkills
              .filter((skill) => !preferences.skills.includes(skill))
              .map((skill) => (
                <Button
                  key={skill}
                  variant="outline"
                  onClick={() => toggleSelection("skills", skill)}
                  className="rounded-full text-xs sm:text-sm border-gray-300 hover:border-purple-300"
                >
                  {skill}
                </Button>
              ))}
          </div>

          <div>
            <div className="flex items-center space-x-2 mb-4">
              <XCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
              <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white">
                Are there any skills you don't want to work with?
              </h3>
            </div>
            <p className="text-gray-600 dark:text-gray-400 mb-4 text-sm sm:text-base">Skills to filter out</p>
            <div className="flex flex-wrap gap-2">
              {allSkills
                .filter((skill) => !preferences.skills.includes(skill))
                .map((skill) => (
                  <Button
                    key={skill}
                    variant={preferences.avoidSkills.includes(skill) ? "default" : "outline"}
                    onClick={() => toggleSelection("avoidSkills", skill)}
                    className={`rounded-full text-xs sm:text-sm ${
                      preferences.avoidSkills.includes(skill)
                        ? "bg-red-500 hover:bg-red-600 text-white"
                        : "border-gray-300 hover:border-red-300"
                    }`}
                  >
                    {skill}
                  </Button>
                ))}
            </div>
          </div>
        </div>
      </div>
    )
  }

  const renderSalaryStep = () => (
    <div className="space-y-6 sm:space-y-8">
      <div className="text-center">
        <h2 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white mb-2">
          What is your minimum expected salary?
        </h2>
        <p className="text-gray-600 dark:text-gray-400 text-sm sm:text-base">
          We'll only use this to match you with jobs and will not share this data
        </p>
      </div>

      <div className="max-w-md mx-auto">
        <div className="space-y-4">
          <div className="text-center">
            <label className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white">At least</label>
          </div>
          <div className="flex items-center space-x-2">
            <span className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white">$</span>
            <Input
              type="number"
              value={preferences.minimumSalary}
              onChange={(e) =>
                setPreferences((prev) => ({
                  ...prev,
                  minimumSalary: Number.parseInt(e.target.value) || 0,
                }))
              }
              className="text-xl sm:text-2xl font-bold text-center"
              min="0"
              step="1000"
            />
            <span className="text-base sm:text-lg text-gray-600 dark:text-gray-400">USD</span>
          </div>
          <input
            type="range"
            min="18000"
            max="500000"
            step="1000"
            value={preferences.minimumSalary}
            onChange={(e) =>
              setPreferences((prev) => ({
                ...prev,
                minimumSalary: Number.parseInt(e.target.value),
              }))
            }
            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700 slider"
          />
          <div className="flex justify-between text-sm text-gray-500">
            <span>$18k</span>
            <span>$500k+</span>
          </div>
        </div>
      </div>
    </div>
  )

  const renderSecurityStep = () => (
    <div className="space-y-6 sm:space-y-8">
      <div className="text-center">
        <h2 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white mb-2">
          Would you like to see roles that require top security clearance?
        </h2>
        <p className="text-gray-600 dark:text-gray-400 text-sm sm:text-base">
          Certain government and defense-related positions may require security clearance.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row justify-center gap-4">
        {["Yes", "No"].map((option) => (
          <Button
            key={option}
            variant={preferences.securityClearance === option ? "default" : "outline"}
            onClick={() => setPreferences((prev) => ({ ...prev, securityClearance: option }))}
            className={`rounded-full px-6 sm:px-8 py-3 text-base sm:text-lg ${
              preferences.securityClearance === option
                ? "bg-purple-600 hover:bg-purple-700 text-white"
                : "border-gray-300 hover:border-purple-300"
            }`}
          >
            {option}
          </Button>
        ))}
      </div>
    </div>
  )

  const renderStatusStep = () => (
    <div className="space-y-6 sm:space-y-8">
      <div className="text-center">
        <h2 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white mb-2">
          Lastly, what's the status of your job search?
        </h2>
      </div>

      <div className="flex flex-col gap-4 max-w-md mx-auto">
        {["Actively looking", "Not looking but open to offers", "Not looking and closed to offers"].map((status) => (
          <Button
            key={status}
            variant={preferences.jobSearchStatus === status ? "default" : "outline"}
            onClick={() => setPreferences((prev) => ({ ...prev, jobSearchStatus: status }))}
            className={`rounded-full py-3 text-sm sm:text-lg ${
              preferences.jobSearchStatus === status
                ? "bg-purple-600 hover:bg-purple-700 text-white"
                : "border-gray-300 hover:border-purple-300"
            }`}
          >
            {status}
          </Button>
        ))}
      </div>
    </div>
  )

  const renderCurrentStep = () => {
    switch (currentStep) {
      case 0:
        return renderRoleTypeStep()
      case 1:
        return renderLocationStep()
      case 2:
        return renderRoleLevelStep()
      case 3:
        return renderCompanySizeStep()
      case 4:
        return renderIndustriesStep()
      case 5:
        return renderSkillsStep()
      case 6:
        return renderSalaryStep()
      case 7:
        return renderSecurityStep()
      case 8:
        return renderStatusStep()
      default:
        return renderRoleTypeStep()
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="flex">
        {/* Mobile Sidebar Overlay */}
        {sidebarOpen && (
          <div className="fixed inset-0 bg-black bg-opacity-50 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
        )}

        {/* Sidebar */}
        <div
          className={`${
            sidebarOpen ? "translate-x-0" : "-translate-x-full"
          } lg:translate-x-0 fixed lg:relative z-50 lg:z-auto w-full sm:w-80 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 min-h-screen transition-transform duration-300 ease-in-out`}
        >
          <div className="p-4 sm:p-6">
            <div className="flex items-center justify-between lg:hidden mb-4">
              <h1 className="text-lg font-bold text-gray-900 dark:text-white">Job Preferences</h1>
              <Button variant="ghost" size="sm" onClick={() => setSidebarOpen(false)}>
                <X className="w-5 h-5" />
              </Button>
            </div>

            <h1 className="hidden lg:block text-xl font-bold text-gray-900 dark:text-white mb-8">
              Job Preference Quiz | JobSpark AI
            </h1>

            <nav className="space-y-2">
              {steps.map((step, index) => (
                <div
                  key={step.id}
                  className={`p-3 rounded-lg cursor-pointer transition-colors ${
                    index === currentStep
                      ? "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 border-l-4 border-purple-500"
                      : index < currentStep
                      ? "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
                      : "text-gray-400 dark:text-gray-500"
                  }`}
                  onClick={() => {
                    if (index <= currentStep) {
                      setCurrentStep(index)
                      setSidebarOpen(false)
                    }
                  }}
                >
                  <span className="text-sm sm:text-base">{step.title}</span>
                </div>
              ))}
            </nav>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1">
          <div className="max-w-4xl mx-auto p-4 sm:p-8">
            {/* Progress Header */}
            <div className="flex items-center justify-between mb-6 sm:mb-8">
              <div className="flex items-center space-x-2">
                <Button variant="ghost" size="sm" onClick={() => setSidebarOpen(!sidebarOpen)} className="lg:hidden">
                  <Menu className="w-5 h-5" />
                </Button>
                <Button
                  variant="ghost"
                  onClick={handleBack}
                  disabled={currentStep === 0}
                  className="flex items-center space-x-2 text-gray-600 dark:text-gray-400"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span className="hidden sm:block">BACK</span>
                </Button>
              </div>

            <div className="flex items-center space-x-2 sm:space-x-4">
                <Progress value={steps[currentStep].progress} className="w-20 sm:w-32" />
                <span className="text-sm sm:text-lg font-semibold text-gray-900 dark:text-white">
                  {steps[currentStep].progress}%
                </span>
              <a href="/profile" aria-label="Profile">
                <Avatar className="h-8 w-8 cursor-pointer">
                  {avatarUrl ? <AvatarImage src={avatarUrl} /> : null}
                  <AvatarFallback>{(fullName || 'U').charAt(0).toUpperCase()}</AvatarFallback>
                </Avatar>
              </a>
              </div>
            </div>

            {/* Step Content */}
            <div className="mb-8 sm:mb-12">{renderCurrentStep()}</div>

            {/* Navigation */}
            <div className="flex justify-center">
              <Button
                onClick={handleNext}
                className="bg-teal-500 hover:bg-teal-600 text-white px-6 sm:px-8 py-3 rounded-full text-base sm:text-lg font-medium flex items-center space-x-2 w-full sm:w-auto"
              >
                <span>{currentStep === steps.length - 1 ? "Save" : "Save and Continue"}</span>
                <ArrowRight className="w-4 h-4 sm:w-5 sm:h-5" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
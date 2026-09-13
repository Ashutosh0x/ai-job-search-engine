// components/dashboard.tsx
"use client"

import { useState, useEffect, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import {
  Search,
  MapPin,
  Clock,
  DollarSign,
  Building2,
  Bookmark,
  Share2,
  Copy,
  Heart,
  Calendar,
  FileText,
  User,
  Settings,
  LogOut,
  Bell,
  HelpCircle,
  Flag,
  ChevronDown,
  Filter,
  Sparkles,
  Zap,
  CheckCircle,
  Menu,
  X,
  File,
} from "lucide-react"
import { useRouter } from "next/navigation"
import { getSupabaseClientSafe } from "@/lib/supabase"
import { FaMoneyBillWave, FaRegClock, FaMapMarkerAlt, FaBuilding } from "react-icons/fa";
import { SearchableSelect } from "@/components/ui/searchable-select";

interface Resume {
  id: string;
  file_name: string;
  file_url: string;
  parsed_text: string;
  parsed_info: any; // JSONB type
  created_at: string;
}

interface Country {
  id: number;
  name: string;
  iso2: string;
}

interface State {
  id: number;
  name: string;
  country_code: string;
}

interface City {
  id: number;
  name: string;
  state_code: string;
}

export default function Dashboard() {
  const [selectedJob, setSelectedJob] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("cloud engineer")
  const [mostRecent, setMostRecent] = useState(true)
  const [activeTab, setActiveTab] = useState("overview")
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [loadingResumes, setLoadingResumes] = useState(true);
  const [errorResumes, setErrorResumes] = useState<string | null>(null);
  const [jobs, setJobs] = useState<any[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [errorJobs, setErrorJobs] = useState<string | null>(null);
  const [userPreferences, setUserPreferences] = useState<any>(null);
  const [selectedLocation, setSelectedLocation] = useState("");
  const [selectedType, setSelectedType] = useState("");
  const [selectedWorkType, setSelectedWorkType] = useState("");
  const [selectedSalary, setSelectedSalary] = useState("");
  const [selectedExperience, setSelectedExperience] = useState("");
  const [selectedCountry, setSelectedCountry] = useState("");
  const [selectedState, setSelectedState] = useState("");
  const [selectedCity, setSelectedCity] = useState("");
  const [countries, setCountries] = useState<Country[]>([]);
  const [states, setStates] = useState<State[]>([]);
  const [cities, setCities] = useState<City[]>([]);
  const [loadingCountries, setLoadingCountries] = useState(false);
  const [loadingStates, setLoadingStates] = useState(false);
  const [loadingCities, setLoadingCities] = useState(false);

  const router = useRouter()
  const supabase = getSupabaseClientSafe();
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [fullName, setFullName] = useState<string | null>(null)

  useEffect(() => {
    const fetchProfile = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('profiles')
        .select('full_name, avatar_url')
        .eq('id', user.id)
        .single();
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
    }
    fetchProfile()
  }, [supabase])

  // Extract unique filter values from jobs
  const uniqueLocations = useMemo(() => Array.from(new Set(jobs.map(j => j.location).filter(Boolean))), [jobs]);
  const uniqueTypes = useMemo(() => Array.from(new Set(jobs.map(j => j.type).filter(Boolean))), [jobs]);
  const uniqueWorkTypes = useMemo(() => Array.from(new Set(jobs.map(j => j.work_type).filter(Boolean))), [jobs]);
  const uniqueSalaries = useMemo(() => Array.from(new Set(jobs.map(j => j.salary).filter(Boolean))), [jobs]);
  const uniqueExperiences = useMemo(() => Array.from(new Set(jobs.map(j => j.experience).filter(Boolean))), [jobs]);

  // recommendedJobs must be defined before filteredJobs
  const recommendedJobs = jobs.filter(job => {
    if (!userPreferences || Object.keys(userPreferences).length === 0) return true;

    // Only filter if locations is a non-empty array
    if (Array.isArray(userPreferences.locations) && userPreferences.locations.length > 0) {
      if (!userPreferences.locations.includes(job.location)) return false;
    }

    // Only filter if roleTypes is a non-empty array, and use word-based matching against job.title
    if (Array.isArray(userPreferences.roleTypes) && userPreferences.roleTypes.length > 0) {
      if (!userPreferences.roleTypes.some((role: string) =>
        role.split(/\s+/).some((word: string) =>
          job.title.toLowerCase().includes(word.toLowerCase())
        )
      )) return false;
    }

    return true;
  });

  // Fetch countries on component mount
  useEffect(() => {
    const fetchCountries = async () => {
      setLoadingCountries(true);
      try {
        const { data, error } = await supabase
          .from('countries')
          .select('id, name, iso2')
          .order('name');
        
        if (error) throw error;
        setCountries(data as Country[] || []);
      } catch (error) {
        console.error('Error fetching countries:', error);
      } finally {
        setLoadingCountries(false);
      }
    };

    fetchCountries();
  }, [supabase]);

  // Fetch states when country changes
  useEffect(() => {
    const fetchStates = async () => {
      if (!selectedCountry) {
        setStates([]);
        return;
      }

      setLoadingStates(true);
      try {
        const { data, error } = await supabase
          .from('states')
          .select('id, name, country_code')
          .eq('country_code', selectedCountry)
          .order('name');
        
        if (error) throw error;
        setStates(data as State[] || []);
      } catch (error) {
        console.error('Error fetching states:', error);
      } finally {
        setLoadingStates(false);
      }
    };

    fetchStates();
  }, [selectedCountry, supabase]);

  // Fetch cities when state changes
  useEffect(() => {
    const fetchCities = async () => {
      if (!selectedState) {
        setCities([]);
        return;
      }

      setLoadingCities(true);
      try {
        const { data, error } = await supabase
          .from('cities')
          .select('id, name, state_code')
          .eq('state_code', selectedState)
          .order('name');
        
        if (error) throw error;
        setCities(data as City[] || []);
      } catch (error) {
        console.error('Error fetching cities:', error);
      } finally {
        setLoadingCities(false);
      }
    };

    fetchCities();
  }, [selectedState, supabase]);

  // Filter jobs based on selected filters
  const filteredJobs = recommendedJobs.filter(job => {
    // Use proper location columns if available, otherwise fall back to location field
    if (selectedCountry) {
      if (job.country_code && job.country_code !== selectedCountry) return false;
      if (!job.country_code && job.location && !job.location.toLowerCase().includes(selectedCountry.toLowerCase())) return false;
    }
    if (selectedState) {
      if (job.state_code && job.state_code !== selectedState) return false;
    }
    if (selectedCity) {
      if (job.city_name && job.city_name !== selectedCity) return false;
    }
    if (selectedType && job.type !== selectedType) return false;
    if (selectedWorkType && job.work_type !== selectedWorkType) return false;
    if (selectedSalary && job.salary !== selectedSalary) return false;
    if (selectedExperience && job.experience !== selectedExperience) return false;
    return true;
  });

  // Check authentication and fetch resumes
  useEffect(() => {
    const checkAuthAndFetchResumes = async () => {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) {
        router.push("/login");
        return;
      }

      // Fetch resumes
      const { data, error } = await supabase
        .from('resumes')
        .select('id, file_name, file_url, parsed_text, parsed_info, created_at')
        .order('created_at', { ascending: false });

      if (error) {
        console.error("Error fetching resumes:", error);
        setErrorResumes(error.message);
      } else {
        setResumes(data || []);
      }
      setLoadingResumes(false);
    };

    checkAuthAndFetchResumes();
  }, [router, supabase]);

  useEffect(() => {
    const fetchJobs = async () => {
      setLoadingJobs(true);
      const { data, error } = await supabase
        .from('jobs')
        .select('*')
        .order('posted_time', { ascending: false });
      if (error) {
        setErrorJobs(error.message);
        setJobs([]);
      } else {
        setJobs(data || []);
      }
      setLoadingJobs(false);
    };

    fetchJobs();
    // Realtime subscription
    const jobsChannel = supabase
      .channel('public:jobs')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, (payload: unknown) => {
        fetchJobs();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(jobsChannel);
    };
  }, [supabase]);

  useEffect(() => {
    const fetchPreferences = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('profiles')
        .select('preferences')
        .eq('id', user.id)
        .single();
      setUserPreferences(data?.preferences || {});
    };
    fetchPreferences();
  }, [supabase]);

  console.log("userPreferences:", userPreferences);
  console.log("jobs:", jobs);
  // Filter jobs based on user preferences
  console.log("recommendedJobs:", recommendedJobs);

  const currentJob = selectedJob !== null ? recommendedJobs[selectedJob] : null;

  const handleLogout = () => {
    localStorage.removeItem("isAuthenticated")
    localStorage.removeItem("userEmail")
    router.push("/")
  }

  if (loadingJobs || userPreferences === null) {
    return <div className="flex items-center justify-center min-h-screen text-lg text-gray-600 dark:text-gray-300">Loading...</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Top Navigation */}
      <nav className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 sm:px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4 sm:space-x-8">
            <div className="flex items-center space-x-2">
              <div className="w-8 h-8 bg-gradient-to-br from-purple-500 to-pink-500 rounded-lg flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-white" />
              </div>
              <span className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white">JobSpark AI</span>
            </div>

            {/* Desktop Navigation */}
            <div className="hidden lg:flex items-center space-x-6">
              <Button variant="ghost" className="text-gray-600 dark:text-gray-300 hover:text-purple-600">
                <Building2 className="w-4 h-4 mr-2" />
                Dashboard
              </Button>
              <Button variant="ghost" className="text-gray-600 dark:text-gray-300 hover:text-purple-600">
                <Heart className="w-4 h-4 mr-2" />
                Matches
              </Button>
              <Button variant="ghost" className="text-purple-600 font-medium">
                <Calendar className="w-4 h-4 mr-2" />
                Jobs
              </Button>
              <Button variant="ghost" className="text-gray-600 dark:text-gray-300 hover:text-purple-600">
                <Clock className="w-4 h-4 mr-2" />
                Job Tracker
              </Button>
              <Button
                variant="ghost"
                className={`${
                  activeTab === "my-resumes"
                    ? "text-purple-600 font-medium"
                    : "text-gray-600 dark:text-gray-300 hover:text-purple-600"
                }`}
                onClick={() => setActiveTab("my-resumes")}
              >
                <FileText className="w-4 h-4 mr-2" />
                My Resumes
              </Button>
              {/* CORRECTED: Changed to "/profile" */}
              <Button
                variant="ghost"
                className="text-gray-600 dark:text-gray-300 hover:text-purple-600"
                onClick={() => router.push("/profile")} // <--- CHANGED THIS LINE
              >
                <User className="w-4 h-4 mr-2" />
                Profile
              </Button>
            </div>

            {/* Mobile Menu Button */}
            <Button variant="ghost" size="sm" onClick={() => setSidebarOpen(!sidebarOpen)} className="lg:hidden">
              {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </Button>
          </div>

          <div className="flex items-center space-x-2 sm:space-x-4">
            <Button variant="ghost" size="sm" className="text-gray-600 dark:text-gray-300 hidden sm:flex">
              <Share2 className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="sm" className="text-gray-600 dark:text-gray-300 hidden sm:flex">
              <HelpCircle className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="sm" className="text-gray-600 dark:text-gray-300">
              <Bell className="w-4 h-4" />
            </Button>

              <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="flex items-center space-x-2">
                  <a href="/profile" aria-label="Profile">
                    <Avatar className="w-8 h-8 bg-purple-500 cursor-pointer">
                      {avatarUrl ? <AvatarImage src={avatarUrl} /> : null}
                      <AvatarFallback className="bg-purple-500 text-white font-medium">{(fullName || 'U').charAt(0).toUpperCase()}</AvatarFallback>
                    </Avatar>
                  </a>
                  <ChevronDown className="w-4 h-4 text-gray-600 dark:text-gray-300 hidden sm:block" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                {/* CORRECTED: Changed to "/profile" */}
                <DropdownMenuItem onClick={() => router.push("/profile")}> {/* <--- CHANGED THIS LINE */}
                  <User className="w-4 h-4 mr-2" />
                  Profile
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <Flag className="w-4 h-4 mr-2" />
                  Report Issues
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <HelpCircle className="w-4 h-4 mr-2" />
                  Support
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <Settings className="w-4 h-4 mr-2" />
                  Settings
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleLogout}>
                  <LogOut className="w-4 h-4 mr-2" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </nav>

      <div className="flex h-[calc(100vh-73px)]">
        {/* Mobile Sidebar Overlay */}
        {sidebarOpen && (
          <div className="fixed inset-0 bg-black bg-opacity-50 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
        )}

        {/* Left Sidebar - Job Search */}
        <div
          className={`${
            sidebarOpen ? "translate-x-0" : "-translate-x-full"
          } lg:translate-x-0 fixed lg:relative z-50 lg:z-auto w-full sm:w-80 lg:w-1/3 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col transition-transform duration-300 ease-in-out`}
        >
          {/* Search Header */}
          <div className="p-4 sm:p-6 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between lg:hidden mb-4">
              <h1 className="text-xl font-bold text-gray-900 dark:text-white">Search Jobs</h1>
              <Button variant="ghost" size="sm" onClick={() => setSidebarOpen(false)}>
                <X className="w-5 h-5" />
              </Button>
            </div>

            <h1 className="hidden lg:block text-2xl font-bold text-gray-900 dark:text-white mb-4">Search All Jobs</h1>

            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search jobs..."
                className="pl-10 bg-gray-50 dark:bg-gray-700 border-gray-200 dark:border-gray-600"
              />
            </div>

            <div className="p-4 sm:p-6 border-b border-gray-200 dark:border-gray-700">
            <div className="flex flex-wrap gap-2 mb-4">
                {/* Country Filter */}
                <SearchableSelect
                  options={[
                    { value: "", label: "All Countries" },
                    ...countries.map(country => ({
                      value: country.iso2,
                      label: country.name
                    }))
                  ]}
                  value={selectedCountry}
                  onChange={(value) => {
                    setSelectedCountry(value);
                    setSelectedState("");
                    setSelectedCity("");
                  }}
                  placeholder="All Countries"
                  disabled={loadingCountries}
                  className="min-w-[150px]"
                />

                {/* State Filter */}
                <SearchableSelect
                  options={[
                    { value: "", label: "All States" },
                    ...states.map(state => ({
                      value: state.country_code,
                      label: state.name
                    }))
                  ]}
                  value={selectedState}
                  onChange={(value) => {
                    setSelectedState(value);
                    setSelectedCity("");
                  }}
                  placeholder="All States"
                  disabled={!selectedCountry || loadingStates}
                  className="min-w-[150px]"
                />

                {/* City Filter */}
                <SearchableSelect
                  options={[
                    { value: "", label: "All Cities" },
                    ...cities.map(city => ({
                      value: city.name,
                      label: city.name
                    }))
                  ]}
                  value={selectedCity}
                  onChange={setSelectedCity}
                  placeholder="All Cities"
                  disabled={!selectedState || loadingCities}
                  className="min-w-[150px]"
                />

                {/* Type Filter */}
                <SearchableSelect
                  options={[
                    { value: "", label: "All Types" },
                    ...uniqueTypes.map(type => ({
                      value: type,
                      label: type
                    }))
                  ]}
                  value={selectedType}
                  onChange={setSelectedType}
                  placeholder="All Types"
                  className="min-w-[120px]"
                />

                {/* Work Type Filter */}
                <SearchableSelect
                  options={[
                    { value: "", label: "All Work Types" },
                    ...uniqueWorkTypes.map(wt => ({
                      value: wt,
                      label: wt
                    }))
                  ]}
                  value={selectedWorkType}
                  onChange={setSelectedWorkType}
                  placeholder="All Work Types"
                  className="min-w-[120px]"
                />

                {/* Salary Filter */}
                <SearchableSelect
                  options={[
                    { value: "", label: "All Salaries" },
                    ...uniqueSalaries.map(sal => ({
                      value: sal,
                      label: sal
                    }))
                  ]}
                  value={selectedSalary}
                  onChange={setSelectedSalary}
                  placeholder="All Salaries"
                  className="min-w-[120px]"
                />

                {/* Experience Filter */}
                <SearchableSelect
                  options={[
                    { value: "", label: "All Experience Levels" },
                    ...uniqueExperiences.map(exp => ({
                      value: exp,
                      label: exp
                    }))
                  ]}
                  value={selectedExperience}
                  onChange={setSelectedExperience}
                  placeholder="All Experience Levels"
                  className="min-w-[120px]"
                />
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <Button variant="ghost" size="sm" className="text-purple-600 text-xs sm:text-sm">
                  <Heart className="w-3 h-3 sm:w-4 sm:h-4 mr-1" />
                  Save Search
                </Button>
              </div>
            </div>
          </div>

          {/* Job Results */}
          <div className="flex-1 overflow-y-auto">
            <div className="p-4">
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">Showing 21 of 10,022 Jobs</span>
                <div className="flex items-center space-x-2">
                  <Switch checked={mostRecent} onCheckedChange={setMostRecent} />
                  <span className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 hidden sm:block">
                    Most recent
                  </span>
                </div>
              </div>

              <div className="space-y-3">
                {filteredJobs.map((job, index) => (
                  <Card
                    key={job.id}
                    className={`cursor-pointer transition-all duration-200 hover:shadow-md ${
                      selectedJob === index
                        ? "ring-2 ring-purple-500 bg-purple-50 dark:bg-purple-900/20"
                        : "hover:bg-gray-50 dark:hover:bg-gray-700"
                    }`}
                    onClick={() => setSelectedJob(index)}
                  >
                    <CardContent className="p-3 sm:p-4">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-start space-x-3">
                          <div className="w-8 h-8 sm:w-10 sm:h-10 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center text-sm sm:text-lg">
                            <img src={job.company_logo_url} alt={job.company} style={{ width: 40, height: 40, borderRadius: 8 }} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <h3 className="font-semibold text-gray-900 dark:text-white text-sm sm:text-base truncate">
                              {job.title}
                            </h3>
                            <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 truncate">
                              {job.company}
                            </p>
                          </div>
                        </div>
                        <Button variant="ghost" size="sm" className="text-gray-400 hover:text-gray-600 flex-shrink-0">
                          <Bookmark className="w-3 h-3 sm:w-4 sm:h-4" />
                        </Button>
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center text-xs sm:text-sm text-gray-600 dark:text-gray-400">
                          <Badge variant="outline" className="mr-2 text-xs">
                            {job.type}
                          </Badge>
                          <MapPin className="w-3 h-3 mr-1 flex-shrink-0" />
                          <span className="truncate">{job.location}</span>
                        </div>

                        {job.salary !== "No salary listed" && (
                          <div className="flex items-center text-xs sm:text-sm text-gray-600 dark:text-gray-400">
                            <DollarSign className="w-3 h-3 mr-1 flex-shrink-0" />
                            <span className="truncate">{job.salary}</span>
                          </div>
                        )}

                        <div className="flex items-center text-xs sm:text-sm text-gray-600 dark:text-gray-400">
                          <Building2 className="w-3 h-3 mr-1 flex-shrink-0" />
                          <span className="truncate">{job.work_type}</span>
                        </div>
                      </div>
                      <a href={job.job_link} target="_blank" rel="noopener noreferrer" className="text-purple-600 hover:underline text-sm block mt-2">
                        View Job
                      </a>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Right Panel - Collapsible Job Details */}
        <div
          className={`transition-all duration-300 bg-white dark:bg-gray-800 overflow-y-auto ${
            currentJob ? "w-full sm:w-2/3 p-4 sm:p-6" : "w-0 p-0"
          }`}
          style={{ minWidth: currentJob ? 320 : 0, maxWidth: currentJob ? 900 : 0 }}
        >
          {currentJob && (
            <div className="relative h-full">
              <button
                className="absolute top-2 right-2 z-10 bg-gray-200 dark:bg-gray-700 rounded-full p-2 hover:bg-gray-300 dark:hover:bg-gray-600"
                onClick={() => setSelectedJob(null)}
                aria-label="Close job details"
              >
                ×
              </button>
              <div className="mb-4">
                <span className="inline-block px-3 py-1 bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300 rounded-full text-xs font-medium mb-2">
                  {currentJob.type}
                </span>
                  <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white mb-2">
                  {currentJob.title}
                  </h1>
                <p className="text-gray-600 dark:text-gray-400 text-sm sm:text-base mb-2">{currentJob.posted_time}</p>
                <div className="flex items-center space-x-2 mb-2">
                  <span className="font-semibold text-gray-900 dark:text-white">{currentJob.company}</span>
                  {currentJob.company_logo_url && (
                    <img src={currentJob.company_logo_url} alt={currentJob.company} className="w-8 h-8 rounded ml-2" />
                  )}
                </div>
                <div className="text-gray-700 dark:text-gray-300 mb-4">{currentJob.description}</div>
              </div>
              <div className="mb-4">
                <h2 className="font-semibold text-lg text-gray-900 dark:text-white mb-2">Summary</h2>
                <div className="flex flex-wrap gap-4 text-sm text-gray-600 dark:text-gray-400 items-center">
                  <div className="flex items-center gap-1"><FaMoneyBillWave /> {currentJob.salary}</div>
                  <div className="flex items-center gap-1"><FaRegClock /> {currentJob.experience}</div>
                  <div className="flex items-center gap-1"><FaMapMarkerAlt /> {currentJob.location}</div>
                  <div className="flex items-center gap-1"><FaBuilding /> {currentJob.work_type}</div>
                </div>
                    </div>
              {currentJob.requirements && (
                <div className="mb-4">
                  <h2 className="font-semibold text-lg text-gray-900 dark:text-white mb-2">Requirements</h2>
                  <ul className="list-disc pl-5 text-gray-700 dark:text-gray-300">
                    {Array.isArray(currentJob.requirements.skills)
                      ? currentJob.requirements.skills.map((req: string, idx: number) => (
                          <li key={idx}>{req}</li>
                        ))
                      : null}
                    {currentJob.requirements.education && (
                      <li>{currentJob.requirements.education}</li>
                    )}
                  </ul>
              </div>
            )}
              {currentJob.matching_preferences && (
                <div className="mb-4">
                  <h2 className="font-semibold text-lg text-gray-900 dark:text-white mb-2">Matching Preferences</h2>
                  <ul className="list-disc pl-5 text-gray-700 dark:text-gray-300">
                    {Object.entries(currentJob.matching_preferences).map(([key, value], idx) => (
                      <li key={idx}>{key}: {Array.isArray(value) ? value.join(', ') : String(value)}</li>
                    ))}
                  </ul>
                </div>
              )}
              <a href={currentJob.job_link} target="_blank" rel="noopener noreferrer" className="inline-block mt-4 px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 transition">View/Apply on Company Site</a>
              </div>
            )}
        </div>
      </div>
    </div>
  )
}
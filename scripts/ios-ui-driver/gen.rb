# Generates the Driver Xcode project. Usage: ruby gen.rb <project-dir> <working-dir>
# <project-dir> must already hold Driver/ and DriverUITests/ (driver.sh copies the sources there).
# <working-dir> is where the test polls for commands; it is baked into DriverUITests/Config.swift.
require 'json'

# Gem homes that may hold the xcodeproj gem CocoaPods ships: what the `pod` wrapper script points
# GEM_HOME at, the libexec next to the real `pod`, GEM_HOME, and the Homebrew Cellar.
def cocoapods_gem_homes
  homes = []
  pod = ENV['PATH'].to_s.split(':').map { |d| File.join(d, 'pod') }.find { |p| File.file?(p) }
  if pod
    wrapper = File.read(pod, 4096) rescue ''
    homes << Regexp.last_match(1) if wrapper =~ /GEM_HOME="([^"]+)"/
    homes << File.join(File.dirname(File.realpath(pod)), '..', 'libexec')
  end
  homes << ENV['GEM_HOME'] if ENV['GEM_HOME']
  homes.concat(Dir['/opt/homebrew/Cellar/cocoapods/*/libexec'].sort.reverse)
  homes.concat(Dir['/usr/local/Cellar/cocoapods/*/libexec'].sort.reverse)
  homes
end

def add_cocoapods_gems_to_load_path
  cocoapods_gem_homes.each do |home|
    libs = Dir[File.join(home, 'gems', '*', 'lib')]
    next unless libs.any? { |l| l.include?('/xcodeproj-') }

    $LOAD_PATH.unshift(*libs)
    return true
  end
  false
end

begin
  require 'xcodeproj'
rescue LoadError
  unless add_cocoapods_gems_to_load_path
    abort 'ios-ui-driver: the xcodeproj gem was not found. Install CocoaPods (brew install cocoapods) ' \
          'so that `pod` is on PATH, or run `gem install xcodeproj`.'
  end
  require 'xcodeproj'
end

dir, work = ARGV
abort 'usage: ruby gen.rb <project-dir> <working-dir>' unless dir && work

File.write("#{dir}/DriverUITests/Config.swift", "let DIR = #{work.to_json}\n")

proj = Xcodeproj::Project.new("#{dir}/Driver.xcodeproj")

app = proj.new_target(:application, 'Driver', :ios, '15.1')
app.build_configurations.each do |c|
  c.build_settings['PRODUCT_BUNDLE_IDENTIFIER'] = 'ca.test.driver'
  c.build_settings['GENERATE_INFOPLIST_FILE'] = 'YES'
  c.build_settings['INFOPLIST_KEY_UIApplicationSceneManifest_Generation'] = 'NO'
end
app.add_file_references([proj.main_group.new_group('Driver', 'Driver').new_file('main.swift')])

ut = proj.new_target(:ui_test_bundle, 'DriverUITests', :ios, '15.1')
ut.add_dependency(app)
ut.build_configurations.each do |c|
  c.build_settings['PRODUCT_BUNDLE_IDENTIFIER'] = 'ca.test.driver.uitests'
  c.build_settings['GENERATE_INFOPLIST_FILE'] = 'YES'
  c.build_settings['TEST_TARGET_NAME'] = 'Driver'
  c.build_settings['SWIFT_VERSION'] = '5.0'
end
tests = proj.main_group.new_group('DriverUITests', 'DriverUITests')
ut.add_file_references([tests.new_file('DriverUITests.swift'), tests.new_file('Config.swift')])

proj.save

scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(app)
scheme.add_test_target(ut)
scheme.save_as("#{dir}/Driver.xcodeproj", 'Driver', true)

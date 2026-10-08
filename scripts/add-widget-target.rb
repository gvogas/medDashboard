# npm run ios:widget — add the home-screen widget extension (ios/App/TermWidget) to the Xcode
# project as its own target, embedded in the app: what docs/IOS.md → Widgets does by hand.
# Needs the xcodeproj gem, which CocoaPods brings: `gem install xcodeproj` (or `brew install
# cocoapods`). Run it once; it stops if the target is already there.

require 'json'
begin
  require 'xcodeproj'
rescue LoadError
  abort "The xcodeproj gem is missing. Install it with:  gem install xcodeproj  (or sudo gem install xcodeproj)"
end

root = File.expand_path('..', __dir__)
cfg = JSON.parse(File.read(File.join(root, 'app.config.json')))
project = Xcodeproj::Project.open(File.join(root, 'ios/App/App.xcodeproj'))

if project.targets.any? { |t| t.name == 'TermWidget' }
  puts 'The TermWidget target is already in the project.'
  exit 0
end

app = project.targets.find { |t| t.name == 'App' } or abort 'No App target in ios/App/App.xcodeproj'
app_settings = app.build_configurations.first.build_settings

widget = project.new_target(:app_extension, 'TermWidget', :ios, '17.0', nil, :swift)

group = project.main_group.find_subpath('TermWidget', true)
group.set_source_tree('<group>')
group.set_path('TermWidget')
sources = %w[TermWidget.swift TermWidgetData.swift].map { |f| group.new_reference(f) }
widget.add_file_references(sources)
group.new_reference('Info.plist')
group.new_reference('TermWidget.entitlements')
widget.add_system_framework(%w[WidgetKit SwiftUI])

widget.build_configurations.each do |c|
  s = c.build_settings
  s['PRODUCT_BUNDLE_IDENTIFIER'] = "#{cfg['bundleId']}.widget"
  s['PRODUCT_NAME'] = '$(TARGET_NAME)'
  s['INFOPLIST_FILE'] = 'TermWidget/Info.plist'
  s['GENERATE_INFOPLIST_FILE'] = 'NO'
  s['CODE_SIGN_ENTITLEMENTS'] = 'TermWidget/TermWidget.entitlements'
  s['CODE_SIGN_STYLE'] = 'Automatic'
  s['DEVELOPMENT_TEAM'] = cfg['teamId'] unless cfg['teamId'].to_s.empty?
  s['IPHONEOS_DEPLOYMENT_TARGET'] = '17.0'
  s['TARGETED_DEVICE_FAMILY'] = '1,2'
  s['SUPPORTS_MACCATALYST'] = 'YES'
  s['SWIFT_VERSION'] = '5.0'
  s['SKIP_INSTALL'] = 'YES'
  s['MARKETING_VERSION'] = app_settings['MARKETING_VERSION']
  s['CURRENT_PROJECT_VERSION'] = app_settings['CURRENT_PROJECT_VERSION']
  s['LD_RUNPATH_SEARCH_PATHS'] = ['$(inherited)', '@executable_path/Frameworks', '@executable_path/../../Frameworks']
  s['ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME'] = ''
end

# the app builds the widget first and carries it inside, as iOS expects
app.add_dependency(widget)
embed = app.copy_files_build_phases.find { |ph| ph.name == 'Embed Foundation Extensions' } ||
        app.new_copy_files_build_phase('Embed Foundation Extensions')
embed.symbol_dst_subfolder_spec = :plug_ins
file = embed.add_file_reference(widget.product_reference, true)
file.settings = { 'ATTRIBUTES' => ['RemoveHeadersOnCopy'] }

project.save
puts "Added the TermWidget target (#{cfg['bundleId']}.widget). Next: npm run ios:configure, then open Xcode and check"
puts "Signing & Capabilities on both targets: the team, and App Groups → #{cfg['appGroup']}."

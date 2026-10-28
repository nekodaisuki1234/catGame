.PHONY: build-AttendanceFunction

# AWS SAM invokes this target from the repository root (CodeUri in template.yaml).
build-AttendanceFunction:
	mkdir -p "$(ARTIFACTS_DIR)/backend/src" "$(ARTIFACTS_DIR)/day-designs"
	cp -R backend/src/. "$(ARTIFACTS_DIR)/backend/src/"
	cp backend/package.json backend/package-lock.json "$(ARTIFACTS_DIR)/backend/"
	cp day-designs/paper-core.js day-designs/paper-holidays.js "$(ARTIFACTS_DIR)/day-designs/"
	npm ci --omit=dev --ignore-scripts --prefix "$(ARTIFACTS_DIR)/backend"

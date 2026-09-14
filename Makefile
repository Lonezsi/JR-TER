.PHONY: push-update

# Release the current worktree and publish it for the server's updater.
push-update:
ifndef MESSAGE
	$(error pass a release message, for example: make push-update MESSAGE="Fix timetable layout")
endif
	python tools/release.py "$(MESSAGE)"
	git add -A
	git commit -m "$(MESSAGE)"
	git push

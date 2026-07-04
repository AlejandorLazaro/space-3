run_site:
	@bash -c '\
		trap "kill 0" EXIT INT TERM; \
		pnpm run dev & \
		sleep 2; \
		open http://localhost:3000; \
		wait \
	'

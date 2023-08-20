.PHONY: all
all: assets/style.css

assets/style.css: assets/*.sass
	sassc -t expanded assets/*.sass > assets/style.css

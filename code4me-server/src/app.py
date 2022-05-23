from pathlib import Path

import markdown
from flask import Flask, jsonify, render_template
from api import v1
from limiter import limiter

app = Flask(__name__, static_folder="static", template_folder="templates")
limiter.init_app(app)
app.register_blueprint(v1, url_prefix='/api/v1')

index_md = markdown.markdown(Path("markdowns/index.md").read_text())


@app.errorhandler(429)
def page_not_found(e):
    return jsonify(error=429, text=str(e)), 429


@app.route("/")
@app.route("/index.html")
def home():
    return render_template("index.html", md=index_md)


if __name__ == "__main__":
    app.run(host='0.0.0.0', port=3000)

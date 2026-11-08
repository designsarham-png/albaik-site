import { about } from '../data/site';

export default function About() {
  return (
    <section className="about" id="about" aria-labelledby="about-title">
      <div className="wrap">
        <h2 className="title" id="about-title">{about.title[0]}<span>{about.title[1]}</span></h2>
        <p>{about.text}</p>
      </div>
    </section>
  );
}
